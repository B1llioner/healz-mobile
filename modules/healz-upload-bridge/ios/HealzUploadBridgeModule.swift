import ExpoModulesCore
import Foundation

private let maxFiles = 10
private let maxImportFileBytes: Int64 = 50 * 1024 * 1024
private let maxUploadFileBytes: Int64 = 20 * 1024 * 1024
private let maxBatchBytes: Int64 = 100 * 1024 * 1024
private let copyBufferBytes = 64 * 1024
private let cacheTTLMilliseconds: Int64 = 24 * 60 * 60 * 1000
private let stagedKey = "staged_files_v1"
private let consumedNonceKey = "consumed_nonce"
private let consumedAtKey = "consumed_at"
private let stageChangedNotification = Notification.Name("HealzUploadStageDidChange")

private struct SharedFileInputRecord: Record {
  @Field var uri: String = ""
  @Field var mimeType: String = "application/octet-stream"
  @Field var displayName: String?
}

private struct ImportedFileRecord: Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var name: String = ""
  @Field var mimeType: String = "application/octet-stream"
  @Field var size: Int64 = 0
  @Field var kind: String = "original"

  init() {}

  init(id: String, url: URL, name: String, mimeType: String, size: Int64, kind: String) {
    self.id = id
    self.uri = url.absoluteString
    self.name = name
    self.mimeType = mimeType
    self.size = size
    self.kind = kind
  }
}

private struct ImportIssueRecord: Record {
  @Field var code: String = "read_failed"
  @Field var name: String?

  init() {}

  init(code: String, name: String? = nil) {
    self.code = code
    self.name = name
  }
}

private struct ImportBatchResultRecord: Record {
  @Field var files: [ImportedFileRecord] = []
  @Field var issues: [ImportIssueRecord] = []

  init() {}

  init(files: [ImportedFileRecord], issues: [ImportIssueRecord]) {
    self.files = files
    self.issues = issues
  }
}

private struct PreparedFileInputRecord: Record {
  @Field var id: String = ""
  @Field var sourceUri: String = ""
  @Field var name: String = ""
  @Field var mimeType: String = "application/octet-stream"
}

private struct StageFileInputRecord: Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var name: String = ""
  @Field var mimeType: String = "application/octet-stream"
  @Field var size: Int64 = 0
}

private struct StageResultRecord: Record {
  @Field var nonce: String = ""
  @Field var count: Int = 0

  init() {}

  init(nonce: String, count: Int) {
    self.nonce = nonce
    self.count = count
  }
}

private struct StageStatusRecord: Record {
  @Field var state: String = "none"
  @Field var nonce: String?

  init() {}

  init(state: String, nonce: String?) {
    self.state = state
    self.nonce = nonce
  }
}

private struct ImportRejected: Error {
  let code: String
}

public final class HealzUploadBridgeModule: Module {
  private let stateLock = NSLock()
  private let fileManager = FileManager.default

  public func definition() -> ModuleDefinition {
    Name("HealzUploadBridge")

    AsyncFunction("importSharedFiles") { (payloads: [SharedFileInputRecord]) in
      try self.synchronized {
        try self.importSharedFiles(payloads)
      }
    }

    AsyncFunction("adoptPreparedFile") { (input: PreparedFileInputRecord) in
      try self.synchronized {
        try self.adoptPreparedFile(input)
      }
    }

    AsyncFunction("stageForWebView") { (files: [StageFileInputRecord]) in
      try self.synchronized {
        try self.stageForWebView(files)
      }
    }

    AsyncFunction("getStageStatus") { (nonce: String) in
      try self.synchronized {
        try self.getStageStatus(nonce)
      }
    }

    AsyncFunction("clearStage") {
      self.synchronized {
        self.clearStageLocked()
      }
    }

    AsyncFunction("discardFiles") { (ids: [String]) in
      try self.synchronized {
        try self.discardFiles(ids)
      }
    }

    AsyncFunction("cleanupExpired") {
      try self.synchronized {
        try self.cleanupExpiredLocked()
      }
    }
  }

  private func synchronized<T>(_ body: () throws -> T) rethrows -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return try body()
  }

  private func importSharedFiles(_ payloads: [SharedFileInputRecord]) throws -> ImportBatchResultRecord {
    let root = try ensurePendingRoot()
    var imported: [ImportedFileRecord] = []
    var issues: [ImportIssueRecord] = []
    var batchBytes: Int64 = 0
    var shareSourcesToDelete: Set<URL> = []
    defer {
      for source in shareSourcesToDelete {
        try? fileManager.removeItem(at: source)
      }
    }

    for (index, payload) in payloads.enumerated() {
      if index >= maxFiles {
        if
          let rawSource = URL(string: payload.uri),
          let ownedSource = allowedSharedSource(rawSource)
        {
          shareSourcesToDelete.insert(ownedSource)
        }
        issues.append(ImportIssueRecord(code: "too_many_files"))
        continue
      }

      guard
        let rawSource = URL(string: payload.uri),
        rawSource.isFileURL,
        let source = allowedSharedSource(rawSource)
      else {
        issues.append(ImportIssueRecord(code: "unsupported_uri"))
        continue
      }
      shareSourcesToDelete.insert(source)

      let displayName = sanitizeName(payload.displayName ?? source.lastPathComponent)
      let accessedSecurityScope = source.startAccessingSecurityScopedResource()
      defer {
        if accessedSecurityScope {
          source.stopAccessingSecurityScopedResource()
        }
      }

      let advertisedSize = fileSize(source)
      if let advertisedSize, advertisedSize > maxImportFileBytes {
        issues.append(ImportIssueRecord(code: "file_too_large", name: displayName))
        continue
      }
      if let advertisedSize, batchBytes + advertisedSize > maxBatchBytes {
        issues.append(ImportIssueRecord(code: "batch_too_large", name: displayName))
        continue
      }

      let id = UUID().uuidString.lowercased()
      let itemDirectory = root.appendingPathComponent(id, isDirectory: true)
      let temporaryFile = itemDirectory.appendingPathComponent("incoming.tmp")

      do {
        try createProtectedDirectory(itemDirectory)
        let copiedBytes = try copyWithLimits(
          from: source,
          to: temporaryFile,
          existingBatchBytes: batchBytes
        )
        guard let detectedMime = detectMime(temporaryFile) else {
          throw ImportRejected(code: "unsupported_type")
        }

        let finalName = normalizeExtension(displayName, mimeType: detectedMime)
        let finalFile = itemDirectory.appendingPathComponent(finalName)
        try fileManager.moveItem(at: temporaryFile, to: finalFile)
        try protectAndExcludeFromBackup(finalFile)
        touch(itemDirectory)
        batchBytes += copiedBytes
        imported.append(ImportedFileRecord(
          id: id,
          url: finalFile,
          name: finalName,
          mimeType: detectedMime,
          size: copiedBytes,
          kind: "original"
        ))
      } catch let rejection as ImportRejected {
        try? fileManager.removeItem(at: itemDirectory)
        issues.append(ImportIssueRecord(code: rejection.code, name: displayName))
      } catch {
        try? fileManager.removeItem(at: itemDirectory)
        issues.append(ImportIssueRecord(code: "read_failed", name: displayName))
      }
    }

    return ImportBatchResultRecord(files: imported, issues: issues)
  }

  private func adoptPreparedFile(_ input: PreparedFileInputRecord) throws -> ImportedFileRecord {
    let itemDirectory = try resolveItemDirectory(input.id)
    guard let source = URL(string: input.sourceUri), source.isFileURL else {
      throw bridgeError("Prepared file URI is invalid")
    }
    let canonicalSource = canonicalURL(source)
    let cachesRoot = canonicalURL(try cachesDirectory())
    guard isDescendant(canonicalSource, of: cachesRoot), isReadableFile(canonicalSource) else {
      throw bridgeError("Prepared file is outside the private cache")
    }

    let actualSize = fileSize(canonicalSource) ?? -1
    guard actualSize >= 0, actualSize <= maxUploadFileBytes else {
      throw bridgeError("Prepared file exceeds the size limit")
    }
    guard
      let expectedMime = canonicalMime(input.mimeType),
      let detectedMime = detectMime(canonicalSource),
      detectedMime == expectedMime
    else {
      throw bridgeError("Prepared file type does not match its contents")
    }

    let preparedDirectory = itemDirectory.appendingPathComponent("prepared", isDirectory: true)
    try? fileManager.removeItem(at: preparedDirectory)
    try createProtectedDirectory(preparedDirectory)
    let finalName = normalizeExtension(sanitizeName(input.name), mimeType: detectedMime)
    let destination = preparedDirectory.appendingPathComponent(finalName)
    try fileManager.copyItem(at: canonicalSource, to: destination)
    try protectAndExcludeFromBackup(destination)
    touch(itemDirectory)
    try? fileManager.removeItem(at: canonicalSource)

    return ImportedFileRecord(
      id: input.id.lowercased(),
      url: destination,
      name: finalName,
      mimeType: detectedMime,
      size: fileSize(destination) ?? actualSize,
      kind: "prepared"
    )
  }

  private func stageForWebView(_ inputs: [StageFileInputRecord]) throws -> StageResultRecord {
    guard !inputs.isEmpty else {
      throw bridgeError("At least one file is required")
    }
    guard inputs.count <= maxFiles else {
      throw bridgeError("Too many files")
    }

    var batchBytes: Int64 = 0
    var stagedFiles: [[String: Any]] = []
    for input in inputs {
      let itemDirectory = try resolveItemDirectory(input.id)
      guard let rawFile = URL(string: input.uri), rawFile.isFileURL else {
        throw bridgeError("Staged file URI is invalid")
      }
      let file = canonicalURL(rawFile)
      guard isDescendant(file, of: itemDirectory), isReadableFile(file) else {
        throw bridgeError("Staged file does not belong to its queue item")
      }
      guard let actualSize = fileSize(file), actualSize <= maxUploadFileBytes else {
        throw bridgeError("Staged file exceeds the size limit")
      }
      batchBytes += actualSize
      guard batchBytes <= maxBatchBytes else {
        throw bridgeError("Staged batch exceeds the size limit")
      }
      guard
        let expectedMime = canonicalMime(input.mimeType),
        let detectedMime = detectMime(file),
        detectedMime == expectedMime
      else {
        throw bridgeError("Staged file type does not match its contents")
      }

      stagedFiles.append([
        "id": input.id.lowercased(),
        "uri": file.absoluteString,
        "name": file.lastPathComponent,
        "mimeType": detectedMime,
        "size": actualSize,
      ])
      touch(itemDirectory)
    }

    let nonce = UUID().uuidString.lowercased()
    let payload: [String: Any] = [
      "version": 1,
      "nonce": nonce,
      "createdAt": nowMilliseconds(),
      "files": stagedFiles,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload)
    guard let encoded = String(data: data, encoding: .utf8) else {
      throw bridgeError("Unable to encode staged files")
    }

    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: consumedNonceKey)
    defaults.removeObject(forKey: consumedAtKey)
    defaults.set(encoded, forKey: stagedKey)
    notifyStageChanged()
    return StageResultRecord(nonce: nonce, count: inputs.count)
  }

  private func getStageStatus(_ nonce: String) throws -> StageStatusRecord {
    try cleanupExpiredLocked()
    let defaults = UserDefaults.standard
    if
      let payload = stagedPayload(defaults.string(forKey: stagedKey)),
      payload["nonce"] as? String == nonce,
      try stagedPayloadHasFiles(payload)
    {
      return StageStatusRecord(state: "staged", nonce: nonce)
    }
    if defaults.string(forKey: consumedNonceKey) == nonce {
      return StageStatusRecord(state: "consumed", nonce: nonce)
    }
    return StageStatusRecord(state: "none", nonce: nil)
  }

  private func clearStageLocked() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: stagedKey)
    defaults.removeObject(forKey: consumedNonceKey)
    defaults.removeObject(forKey: consumedAtKey)
    notifyStageChanged()
  }

  private func discardFiles(_ ids: [String]) throws {
    let validIds = Set(ids.compactMap { UUID(uuidString: $0)?.uuidString.lowercased() })
    let root = try ensurePendingRoot()
    for id in validIds {
      try? fileManager.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }
    if !validIds.isDisjoint(with: stagedIds()) {
      clearStageLocked()
    }
  }

  private func cleanupExpiredLocked() throws {
    let now = Date()
    let root = try ensurePendingRoot()
    let contents = try fileManager.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
      options: [.skipsHiddenFiles]
    )
    for item in contents {
      let values = try? item.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey])
      guard values?.isDirectory == true, let modified = values?.contentModificationDate else {
        continue
      }
      if now.timeIntervalSince(modified) * 1000 > Double(cacheTTLMilliseconds) {
        try? fileManager.removeItem(at: item)
      }
    }
    cleanupExpiredSharedSources(now: now)

    let defaults = UserDefaults.standard
    let stagedAt = stagedPayload(defaults.string(forKey: stagedKey))?["createdAt"] as? NSNumber
    let consumedAt = defaults.object(forKey: consumedAtKey) as? NSNumber
    let nowMs = nowMilliseconds()
    let stagedExpired = stagedAt.map { nowMs - $0.int64Value > cacheTTLMilliseconds } ?? false
    let consumedExpired = consumedAt.map { nowMs - $0.int64Value > cacheTTLMilliseconds } ?? false
    if stagedExpired || consumedExpired {
      clearStageLocked()
    }
  }

  private func ensurePendingRoot() throws -> URL {
    let root = try applicationSupportDirectory()
      .appendingPathComponent("healz-pending", isDirectory: true)
    if !fileManager.fileExists(atPath: root.path) {
      try createProtectedDirectory(root)
    }
    return canonicalURL(root)
  }

  private func applicationSupportDirectory() throws -> URL {
    guard let result = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      throw bridgeError("Application Support directory is unavailable")
    }
    return result
  }

  private func cachesDirectory() throws -> URL {
    guard let result = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw bridgeError("Caches directory is unavailable")
    }
    return result
  }

  private func createProtectedDirectory(_ url: URL) throws {
    try fileManager.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    try protectAndExcludeFromBackup(url)
  }

  private func protectAndExcludeFromBackup(_ url: URL) throws {
    try fileManager.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
    var mutableURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableURL.setResourceValues(values)
  }

  private func copyWithLimits(
    from source: URL,
    to destination: URL,
    existingBatchBytes: Int64
  ) throws -> Int64 {
    guard isReadableFile(source), let input = InputStream(url: source) else {
      throw ImportRejected(code: "read_failed")
    }
    guard let output = OutputStream(url: destination, append: false) else {
      throw ImportRejected(code: "cache_unavailable")
    }

    input.open()
    output.open()
    defer {
      input.close()
      output.close()
    }

    var copied: Int64 = 0
    var buffer = [UInt8](repeating: 0, count: copyBufferBytes)
    while true {
      let read = input.read(&buffer, maxLength: buffer.count)
      if read < 0 {
        throw ImportRejected(code: "read_failed")
      }
      if read == 0 {
        break
      }
      copied += Int64(read)
      if copied > maxImportFileBytes {
        throw ImportRejected(code: "file_too_large")
      }
      if existingBatchBytes + copied > maxBatchBytes {
        throw ImportRejected(code: "batch_too_large")
      }

      var written = 0
      while written < read {
        let count = buffer.withUnsafeBufferPointer { pointer in
          output.write(pointer.baseAddress!.advanced(by: written), maxLength: read - written)
        }
        if count <= 0 {
          throw ImportRejected(code: "cache_unavailable")
        }
        written += count
      }
    }
    return copied
  }

  private func detectMime(_ file: URL) -> String? {
    guard isReadableFile(file), let handle = try? FileHandle(forReadingFrom: file) else {
      return nil
    }
    defer { try? handle.close() }
    guard let header = try? handle.read(upToCount: 256), header.count >= 4 else {
      return nil
    }

    if header.starts(with: Data("%PDF-".utf8)) {
      return "application/pdf"
    }
    if header.count >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff {
      return "image/jpeg"
    }
    let pngMagic = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if header.starts(with: pngMagic) {
      return "image/png"
    }
    if ascii(header, 0..<4) == "RIFF" && ascii(header, 8..<12) == "WEBP" {
      return "image/webp"
    }
    if ascii(header, 4..<8) == "ftyp" {
      if let brand = ascii(header, 8..<12)?.lowercased(), heicBrands.contains(brand) {
        return "image/heic"
      }
      var offset = 16
      while offset + 4 <= header.count {
        if let brand = ascii(header, offset..<(offset + 4))?.lowercased(), heicBrands.contains(brand) {
          return "image/heic"
        }
        offset += 4
      }
    }
    return nil
  }

  private func ascii(_ data: Data, _ range: Range<Int>) -> String? {
    guard range.lowerBound >= 0, range.upperBound <= data.count else {
      return nil
    }
    return String(data: data.subdata(in: range), encoding: .ascii)
  }

  private func canonicalMime(_ value: String) -> String? {
    switch value.lowercased() {
    case "application/pdf":
      return "application/pdf"
    case "image/jpeg", "image/jpg":
      return "image/jpeg"
    case "image/png":
      return "image/png"
    case "image/webp":
      return "image/webp"
    case "image/heic", "image/heif":
      return "image/heic"
    default:
      return nil
    }
  }

  private func sanitizeName(_ input: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._ ()-"))
    let characters: [Character] = input.unicodeScalars.map { scalar in
      allowed.contains(scalar) ? Character(String(scalar)) : "_"
    }
    let cleaned = String(characters.prefix(120))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if cleaned.isEmpty || cleaned == "." || cleaned == ".." {
      return "document"
    }
    return cleaned
  }

  private func normalizeExtension(_ name: String, mimeType: String) -> String {
    let ext = extensions[mimeType] ?? "bin"
    let lowerName = name.lowercased()
    let accepted: [String]
    switch mimeType {
    case "image/jpeg":
      accepted = [".jpg", ".jpeg"]
    case "image/heic":
      accepted = [".heic", ".heif"]
    default:
      accepted = [".\(ext)"]
    }
    if accepted.contains(where: lowerName.hasSuffix) {
      return name
    }
    let base = (name as NSString).deletingPathExtension
    return "\(base.isEmpty ? "document" : base).\(ext)"
  }

  private func resolveItemDirectory(_ id: String) throws -> URL {
    guard let uuid = UUID(uuidString: id) else {
      throw bridgeError("Invalid file id")
    }
    let root = try ensurePendingRoot()
    let directory = canonicalURL(root.appendingPathComponent(uuid.uuidString.lowercased(), isDirectory: true))
    guard directory.deletingLastPathComponent() == root, isDirectory(directory) else {
      throw bridgeError("Unknown file id")
    }
    return directory
  }

  private func canonicalURL(_ url: URL) -> URL {
    url.standardizedFileURL.resolvingSymlinksInPath()
  }

  private func isDescendant(_ child: URL, of parent: URL) -> Bool {
    let childPath = canonicalURL(child).path
    let parentPath = canonicalURL(parent).path
    return childPath.hasPrefix(parentPath + "/")
  }

  private func isReadableFile(_ url: URL) -> Bool {
    var isDirectory: ObjCBool = false
    return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory)
      && !isDirectory.boolValue
      && fileManager.isReadableFile(atPath: url.path)
  }

  private func isDirectory(_ url: URL) -> Bool {
    var value: ObjCBool = false
    return fileManager.fileExists(atPath: url.path, isDirectory: &value) && value.boolValue
  }

  private func fileSize(_ url: URL) -> Int64? {
    guard
      let attributes = try? fileManager.attributesOfItem(atPath: url.path),
      let value = attributes[.size] as? NSNumber
    else {
      return nil
    }
    return value.int64Value
  }

  private func touch(_ url: URL) {
    try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
  }

  private func appGroupContainer() -> URL? {
    guard
      let appGroupId = Bundle.main.object(forInfoDictionaryKey: "ExpoShareIntoAppGroupId") as? String,
      let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    else {
      return nil
    }
    return canonicalURL(container)
  }

  private func cleanupExpiredSharedSources(now: Date) {
    guard let container = appGroupContainer() else {
      return
    }
    let keys: Set<URLResourceKey> = [
      .isRegularFileKey,
      .isSymbolicLinkKey,
      .contentModificationDateKey,
    ]
    guard let contents = try? fileManager.contentsOfDirectory(
      at: container,
      includingPropertiesForKeys: Array(keys),
      options: [.skipsHiddenFiles]
    ) else {
      return
    }

    for rawFile in contents {
      let stem = rawFile.deletingPathExtension().lastPathComponent
      guard UUID(uuidString: stem) != nil else {
        continue
      }
      let values = try? rawFile.resourceValues(forKeys: keys)
      guard
        values?.isRegularFile == true,
        values?.isSymbolicLink != true,
        let modified = values?.contentModificationDate,
        now.timeIntervalSince(modified) * 1000 > Double(cacheTTLMilliseconds)
      else {
        continue
      }
      let file = canonicalURL(rawFile)
      guard isDescendant(file, of: container) else {
        continue
      }
      try? fileManager.removeItem(at: file)
    }
  }

  private func allowedSharedSource(_ source: URL) -> URL? {
    guard let container = appGroupContainer() else {
      return nil
    }
    let canonicalSource = canonicalURL(source)
    let values = try? source.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
    guard
      isDescendant(canonicalSource, of: container),
      values?.isSymbolicLink != true,
      values?.isRegularFile == true,
      isReadableFile(canonicalSource)
    else {
      return nil
    }
    return canonicalSource
  }

  private func stagedPayload(_ raw: String?) -> [String: Any]? {
    guard
      let raw,
      let data = raw.data(using: .utf8),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return nil
    }
    return value
  }

  private func stagedPayloadHasFiles(_ payload: [String: Any]) throws -> Bool {
    guard
      let createdAt = (payload["createdAt"] as? NSNumber)?.int64Value,
      nowMilliseconds() - createdAt <= cacheTTLMilliseconds,
      let files = payload["files"] as? [[String: Any]],
      !files.isEmpty
    else {
      return false
    }
    for file in files {
      guard
        let id = file["id"] as? String,
        let directory = try? resolveItemDirectory(id),
        isDirectory(directory)
      else {
        return false
      }
    }
    return true
  }

  private func stagedIds() -> Set<String> {
    guard
      let payload = stagedPayload(UserDefaults.standard.string(forKey: stagedKey)),
      let files = payload["files"] as? [[String: Any]]
    else {
      return []
    }
    return Set(files.compactMap { file in
      guard let raw = file["id"] as? String, let uuid = UUID(uuidString: raw) else {
        return nil
      }
      return uuid.uuidString.lowercased()
    })
  }

  private func notifyStageChanged() {
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: stageChangedNotification, object: nil)
    }
  }

  private func nowMilliseconds() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
  }

  private func bridgeError(_ description: String) -> Exception {
    Exception(name: "ERR_HEALZ_UPLOAD_BRIDGE", description: description)
  }

  private let heicBrands: Set<String> = ["heic", "heix", "hevc", "hevx", "heim", "heis"]
  private let extensions: [String: String] = [
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  ]
}
