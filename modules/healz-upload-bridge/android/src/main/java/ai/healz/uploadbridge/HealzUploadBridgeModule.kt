package ai.healz.uploadbridge

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID

private const val MAX_FILES = 10
private const val MAX_FILE_BYTES = 50L * 1024L * 1024L
private const val MAX_BATCH_BYTES = 100L * 1024L * 1024L
private const val COPY_BUFFER_BYTES = 64 * 1024
private const val CACHE_TTL_MS = 24L * 60L * 60L * 1000L
private const val PREFS_NAME = "healz_upload_bridge"
private const val STAGED_KEY = "staged_files_v1"
private const val CONSUMED_NONCE_KEY = "consumed_nonce"
private const val CONSUMED_AT_KEY = "consumed_at"

@OptimizedRecord
data class SharedFileInput(
  @Field val uri: String = "",
  @Field val mimeType: String = "application/octet-stream"
) : Record

@OptimizedRecord
data class ImportedFile(
  @Field val id: String = "",
  @Field val uri: String = "",
  @Field val name: String = "",
  @Field val mimeType: String = "application/octet-stream",
  @Field val size: Long = 0,
  @Field val kind: String = "original"
) : Record

@OptimizedRecord
data class ImportIssue(
  @Field val code: String = "import_failed",
  @Field val name: String? = null
) : Record

@OptimizedRecord
data class ImportBatchResult(
  @Field val files: List<ImportedFile> = emptyList(),
  @Field val issues: List<ImportIssue> = emptyList()
) : Record

@OptimizedRecord
data class PreparedFileInput(
  @Field val id: String = "",
  @Field val sourceUri: String = "",
  @Field val name: String = "",
  @Field val mimeType: String = "application/octet-stream"
) : Record

@OptimizedRecord
data class StageFileInput(
  @Field val id: String = "",
  @Field val uri: String = "",
  @Field val name: String = "",
  @Field val mimeType: String = "application/octet-stream",
  @Field val size: Long = 0
) : Record

@OptimizedRecord
data class StageResult(
  @Field val nonce: String = "",
  @Field val count: Int = 0
) : Record

@OptimizedRecord
data class StageStatus(
  @Field val state: String = "none",
  @Field val nonce: String? = null
) : Record

private data class SourceMetadata(val name: String?, val size: Long?)

private class ImportRejected(val reason: String) : Exception(reason)

class HealzUploadBridgeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val pendingRoot: File
    get() = File(context.filesDir, "healz-pending")

  private val stateLock = Any()

  override fun definition() = ModuleDefinition {
    Name("HealzUploadBridge")

    AsyncFunction("importSharedFiles") { payloads: List<SharedFileInput> ->
      importSharedFiles(payloads)
    }

    AsyncFunction("adoptPreparedFile") { input: PreparedFileInput ->
      adoptPreparedFile(input)
    }

    AsyncFunction("stageForWebView") { files: List<StageFileInput> ->
      stageForWebView(files)
    }

    AsyncFunction("getStageStatus") { nonce: String ->
      getStageStatus(nonce)
    }

    AsyncFunction("clearStage") {
      clearStage()
    }

    AsyncFunction("discardFiles") { ids: List<String> ->
      discardFiles(ids)
    }

    AsyncFunction("cleanupExpired") {
      cleanupExpired()
    }
  }

  private fun importSharedFiles(payloads: List<SharedFileInput>): ImportBatchResult {
    pendingRoot.mkdirs()
    val imported = mutableListOf<ImportedFile>()
    val issues = mutableListOf<ImportIssue>()
    var batchBytes = 0L

    payloads.forEachIndexed { index, payload ->
      if (index >= MAX_FILES) {
        issues += ImportIssue("too_many_files")
        return@forEachIndexed
      }

      val sourceUri = runCatching { Uri.parse(payload.uri) }.getOrNull()
      if (sourceUri == null || sourceUri.scheme != "content") {
        issues += ImportIssue("unsupported_uri")
        return@forEachIndexed
      }

      val metadata = queryMetadata(sourceUri)
      val displayName = metadata.name?.let(::sanitizeName)
      if (metadata.size != null && metadata.size > MAX_FILE_BYTES) {
        issues += ImportIssue("file_too_large", displayName)
        return@forEachIndexed
      }
      if (metadata.size != null && batchBytes + metadata.size > MAX_BATCH_BYTES) {
        issues += ImportIssue("batch_too_large", displayName)
        return@forEachIndexed
      }

      val id = UUID.randomUUID().toString()
      val itemDirectory = File(pendingRoot, id)
      val temporaryFile = File(itemDirectory, "incoming.tmp")

      try {
        if (!itemDirectory.mkdirs()) {
          throw ImportRejected("cache_unavailable")
        }
        val copiedBytes = copyWithLimits(sourceUri, temporaryFile, batchBytes)
        val detectedMime = detectMime(temporaryFile)
          ?: throw ImportRejected("unsupported_type")
        val finalName = normalizeExtension(displayName ?: "document", detectedMime)
        val finalFile = File(itemDirectory, finalName)
        if (!temporaryFile.renameTo(finalFile)) {
          temporaryFile.copyTo(finalFile, overwrite = false)
          temporaryFile.delete()
        }
        itemDirectory.setLastModified(System.currentTimeMillis())
        batchBytes += copiedBytes
        imported += ImportedFile(
          id = id,
          uri = Uri.fromFile(finalFile).toString(),
          name = finalName,
          mimeType = detectedMime,
          size = copiedBytes,
          kind = "original"
        )
      } catch (error: ImportRejected) {
        itemDirectory.deleteRecursively()
        issues += ImportIssue(error.reason, displayName)
      } catch (_: Exception) {
        itemDirectory.deleteRecursively()
        issues += ImportIssue("read_failed", displayName)
      }
    }

    return ImportBatchResult(imported, issues)
  }

  private fun adoptPreparedFile(input: PreparedFileInput): ImportedFile {
    return synchronized(stateLock) {
      val itemDirectory = resolveItemDirectory(input.id)
      val source = fileFromPrivateCacheUri(input.sourceUri)
      if (!source.isFile || !source.canRead()) {
        throw IllegalArgumentException("Prepared file is not readable")
      }
      if (source.length() > MAX_FILE_BYTES) {
        throw IllegalArgumentException("Prepared file exceeds the size limit")
      }

      val expectedMime = canonicalMime(input.mimeType)
        ?: throw IllegalArgumentException("Unsupported prepared MIME type")
      val detectedMime = detectMime(source)
        ?: throw IllegalArgumentException("Unsupported prepared file")
      if (detectedMime != expectedMime) {
        throw IllegalArgumentException("Prepared file MIME does not match its contents")
      }

      val preparedDirectory = File(itemDirectory, "prepared")
      preparedDirectory.deleteRecursively()
      check(preparedDirectory.mkdirs()) { "Unable to create prepared file directory" }
      val finalName = normalizeExtension(sanitizeName(input.name), detectedMime)
      val destination = File(preparedDirectory, finalName)
      source.copyTo(destination, overwrite = false)
      itemDirectory.setLastModified(System.currentTimeMillis())
      if (!source.path.startsWith(pendingRoot.canonicalPath + File.separator)) {
        source.delete()
      }

      ImportedFile(
        id = input.id,
        uri = Uri.fromFile(destination).toString(),
        name = finalName,
        mimeType = detectedMime,
        size = destination.length(),
        kind = "prepared"
      )
    }
  }

  private fun stageForWebView(files: List<StageFileInput>): StageResult {
    return synchronized(stateLock) {
      require(files.isNotEmpty()) { "At least one file is required" }
      require(files.size <= MAX_FILES) { "Too many files" }

      var batchBytes = 0L
      val stagedFiles = JSONArray()
      files.forEach { input ->
        val itemDirectory = resolveItemDirectory(input.id)
        val file = fileFromPendingUri(input.uri)
        require(file.path.startsWith(itemDirectory.path + File.separator)) {
          "Staged file does not belong to its queue item"
        }
        require(file.isFile && file.canRead()) { "Staged file is not readable" }
        val actualSize = file.length()
        require(actualSize <= MAX_FILE_BYTES) { "Staged file exceeds the size limit" }
        batchBytes += actualSize
        require(batchBytes <= MAX_BATCH_BYTES) { "Staged batch exceeds the size limit" }
        val detectedMime = detectMime(file) ?: throw IllegalArgumentException("Unsupported staged file")
        require(detectedMime == canonicalMime(input.mimeType)) { "Staged MIME does not match contents" }

        val contentUri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.HealzUploadFileProvider",
          file
        )

        stagedFiles.put(
          JSONObject()
            .put("id", input.id)
            .put("uri", contentUri.toString())
            .put("name", file.name)
            .put("mimeType", detectedMime)
            .put("size", actualSize)
        )
        itemDirectory.setLastModified(System.currentTimeMillis())
      }

      val nonce = UUID.randomUUID().toString()
      val staged = JSONObject()
        .put("version", 1)
        .put("nonce", nonce)
        .put("createdAt", System.currentTimeMillis())
        .put("files", stagedFiles)
        .toString()

      val committed = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .remove(CONSUMED_NONCE_KEY)
        .remove(CONSUMED_AT_KEY)
        .putString(STAGED_KEY, staged)
        .commit()
      check(committed) { "Unable to stage files" }
      StageResult(nonce, files.size)
    }
  }

  private fun getStageStatus(nonce: String): StageStatus {
    return synchronized(stateLock) {
      cleanupExpiredLocked()
      val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val stagedPayload = preferences.getString(STAGED_KEY, null)?.let { raw ->
        runCatching { JSONObject(raw) }.getOrNull()
      }
      val stagedNonce = stagedPayload?.optString("nonce")
      if (stagedNonce == nonce && stagedPayloadHasFiles(stagedPayload)) {
        return@synchronized StageStatus("staged", nonce)
      }
      if (preferences.getString(CONSUMED_NONCE_KEY, null) == nonce) {
        return@synchronized StageStatus("consumed", nonce)
      }
      StageStatus()
    }
  }

  private fun clearStage() {
    synchronized(stateLock) { clearStageLocked() }
  }

  private fun clearStageLocked() {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(STAGED_KEY)
      .remove(CONSUMED_NONCE_KEY)
      .remove(CONSUMED_AT_KEY)
      .commit()
  }

  private fun discardFiles(ids: List<String>) {
    synchronized(stateLock) {
      val validIds = ids.mapNotNull(::parseUuid).map(UUID::toString).toSet()
      validIds.forEach { id ->
        File(pendingRoot, id).deleteRecursively()
      }
      if (validIds.isNotEmpty() && stagedIds().any(validIds::contains)) {
        clearStageLocked()
      }
    }
  }

  private fun cleanupExpired() {
    synchronized(stateLock) { cleanupExpiredLocked() }
  }

  private fun cleanupExpiredLocked() {
    val now = System.currentTimeMillis()
    pendingRoot.listFiles()?.forEach { item ->
      if (item.isDirectory && now - item.lastModified() > CACHE_TTL_MS) {
        item.deleteRecursively()
      }
    }

    val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val staged = preferences.getString(STAGED_KEY, null)
    val stagedAt = staged?.let { raw ->
      runCatching { JSONObject(raw).optLong("createdAt", 0L) }.getOrDefault(0L)
    } ?: 0L
    val consumedAt = preferences.getLong(CONSUMED_AT_KEY, 0L)
    if ((stagedAt > 0 && now - stagedAt > CACHE_TTL_MS) ||
      (consumedAt > 0 && now - consumedAt > CACHE_TTL_MS)
    ) {
      clearStageLocked()
    }
  }

  private fun stagedIds(): Set<String> {
    val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(STAGED_KEY, null) ?: return emptySet()
    return runCatching {
      val files = JSONObject(raw).optJSONArray("files") ?: return@runCatching emptySet()
      buildSet {
        for (index in 0 until files.length()) {
          files.optJSONObject(index)?.optString("id")?.takeIf(String::isNotBlank)?.let(::add)
        }
      }
    }.getOrDefault(emptySet())
  }

  private fun stagedPayloadHasFiles(payload: JSONObject): Boolean {
    val createdAt = payload.optLong("createdAt", 0L)
    if (createdAt <= 0L || System.currentTimeMillis() - createdAt > CACHE_TTL_MS) return false
    val files = payload.optJSONArray("files") ?: return false
    if (files.length() == 0) return false
    for (index in 0 until files.length()) {
      val id = files.optJSONObject(index)?.optString("id") ?: return false
      val directory = parseUuid(id)?.let { File(pendingRoot, it.toString()) } ?: return false
      if (!directory.isDirectory) return false
    }
    return true
  }

  private fun queryMetadata(uri: Uri): SourceMetadata {
    return runCatching {
      context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )?.use { cursor ->
        if (!cursor.moveToFirst()) {
          return@use SourceMetadata(null, null)
        }
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        val name = if (nameIndex >= 0 && !cursor.isNull(nameIndex)) cursor.getString(nameIndex) else null
        val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else null
        SourceMetadata(name, size)
      } ?: SourceMetadata(null, null)
    }.getOrDefault(SourceMetadata(null, null))
  }

  private fun copyWithLimits(sourceUri: Uri, destination: File, existingBatchBytes: Long): Long {
    val input = context.contentResolver.openInputStream(sourceUri)
      ?: throw ImportRejected("read_failed")
    var copied = 0L
    input.use { source ->
      FileOutputStream(destination).buffered(COPY_BUFFER_BYTES).use { output ->
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        while (true) {
          val read = source.read(buffer)
          if (read < 0) break
          copied += read
          if (copied > MAX_FILE_BYTES) throw ImportRejected("file_too_large")
          if (existingBatchBytes + copied > MAX_BATCH_BYTES) throw ImportRejected("batch_too_large")
          output.write(buffer, 0, read)
        }
      }
    }
    return copied
  }

  private fun detectMime(file: File): String? {
    if (!file.isFile || file.length() < 4) return null
    val header = ByteArray(256)
    val count = FileInputStream(file).use { it.read(header) }
    if (count >= 5 && header.copyOfRange(0, 5).toString(Charsets.US_ASCII) == "%PDF-") {
      return "application/pdf"
    }
    if (count >= 3 &&
      header[0].toInt() and 0xFF == 0xFF &&
      header[1].toInt() and 0xFF == 0xD8 &&
      header[2].toInt() and 0xFF == 0xFF
    ) {
      return "image/jpeg"
    }
    val pngMagic = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    if (count >= pngMagic.size && header.copyOfRange(0, pngMagic.size).contentEquals(pngMagic)) {
      return "image/png"
    }
    if (count >= 12 &&
      header.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
      header.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP"
    ) {
      return "image/webp"
    }
    if (count >= 16 && header.copyOfRange(4, 8).toString(Charsets.US_ASCII) == "ftyp") {
      val majorBrand = header.copyOfRange(8, 12).toString(Charsets.US_ASCII).lowercase()
      if (majorBrand in HEIC_BRANDS) return "image/heic"
      var offset = 16
      while (offset + 4 <= count) {
        val compatibleBrand = header.copyOfRange(offset, offset + 4)
          .toString(Charsets.US_ASCII)
          .lowercase()
        if (compatibleBrand in HEIC_BRANDS) return "image/heic"
        offset += 4
      }
    }
    return null
  }

  private fun sanitizeName(input: String): String {
    val cleaned = input
      .replace(Regex("[^\\p{L}\\p{N}._ ()-]"), "_")
      .trim()
      .take(120)
    return cleaned.takeUnless { it.isBlank() || it == "." || it == ".." } ?: "document"
  }

  private fun normalizeExtension(name: String, mimeType: String): String {
    val extension = EXTENSIONS.getValue(mimeType)
    val lowerName = name.lowercase()
    val acceptedExtensions = when (mimeType) {
      "image/jpeg" -> listOf(".jpg", ".jpeg")
      "image/heic" -> listOf(".heic", ".heif")
      else -> listOf(".$extension")
    }
    if (acceptedExtensions.any(lowerName::endsWith)) return name
    val baseName = name.substringBeforeLast('.').ifBlank { "document" }
    return "$baseName.$extension"
  }

  private fun canonicalMime(mimeType: String): String? = when (mimeType.lowercase()) {
    "application/pdf" -> "application/pdf"
    "image/jpeg", "image/jpg" -> "image/jpeg"
    "image/png" -> "image/png"
    "image/webp" -> "image/webp"
    "image/heic", "image/heif" -> "image/heic"
    else -> null
  }

  private fun resolveItemDirectory(id: String): File {
    val parsedId = parseUuid(id) ?: throw IllegalArgumentException("Invalid file id")
    val directory = File(pendingRoot, parsedId.toString()).canonicalFile
    val root = pendingRoot.canonicalFile
    require(directory.parentFile == root && directory.isDirectory) { "Unknown file id" }
    return directory
  }

  private fun fileFromPrivateCacheUri(value: String): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file") { "Only private file URIs are accepted" }
    val file = File(uri.path ?: throw IllegalArgumentException("Missing file path")).canonicalFile
    val cache = context.cacheDir.canonicalFile
    require(file.path.startsWith(cache.path + File.separator)) { "File is outside private cache" }
    return file
  }

  private fun fileFromPendingUri(value: String): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file") { "Only private file URIs are accepted" }
    val file = File(uri.path ?: throw IllegalArgumentException("Missing file path")).canonicalFile
    val root = pendingRoot.canonicalFile
    require(file.path.startsWith(root.path + File.separator)) { "File is outside the pending area" }
    return file
  }

  private fun parseUuid(value: String): UUID? = runCatching { UUID.fromString(value) }.getOrNull()

  companion object {
    private val HEIC_BRANDS = setOf("heic", "heix", "hevc", "hevx", "heim", "heis")
    private val EXTENSIONS = mapOf(
      "application/pdf" to "pdf",
      "image/jpeg" to "jpg",
      "image/png" to "png",
      "image/webp" to "webp",
      "image/heic" to "heic"
    )
  }
}
