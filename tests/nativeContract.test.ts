import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const patch = readFileSync(
  new URL('../patches/react-native-webview+13.16.1.patch', import.meta.url),
  'utf8',
);
const addedPatch = patch
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1))
  .join('\n');
const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
);
const nativeModule = readFileSync(
  new URL('../modules/healz-upload-bridge/android/src/main/java/ai/healz/uploadbridge/HealzUploadBridgeModule.kt', import.meta.url),
  'utf8',
);
const iosNativeModule = readFileSync(
  new URL('../modules/healz-upload-bridge/ios/HealzUploadBridgeModule.swift', import.meta.url),
  'utf8',
);
const expoSharingPatch = readFileSync(
  new URL('../patches/expo-sharing+57.0.8.patch', import.meta.url),
  'utf8',
);
const addedExpoSharingPatch = expoSharingPatch
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1))
  .join('\n');
const expoSharingTemplate = readFileSync(
  new URL(
    '../node_modules/expo-sharing/plugin/template-files/ios/ShareIntoViewController.swift',
    import.meta.url,
  ),
  'utf8',
);
const nativeManifest = readFileSync(
  new URL('../modules/healz-upload-bridge/android/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);
const providerPaths = readFileSync(
  new URL('../modules/healz-upload-bridge/android/src/main/res/xml/healz_upload_paths.xml', import.meta.url),
  'utf8',
);
const runtimeConfig = readFileSync(
  new URL('../src/config.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('WebView handoff is pinned to exact HTTPS host, chat path, private provider, and non-capture chooser', () => {
  assert.match(addedPatch, /fileChooserParams\.isCaptureEnabled\(\)/);
  assert.match(
    addedPatch,
    /if \(captureEnabled \|\| webView == null \|\| webView\.getUrl\(\) == null\)/,
  );
  assert.match(addedPatch, /!"https"\.equals\(pageUri\.getScheme\(\)\)/);
  assert.match(addedPatch, /!"app\.healz\.ai"\.equals\(pageUri\.getHost\(\)\)/);
  assert.match(addedPatch, /pageUri\.getPort\(\) != -1 && pageUri\.getPort\(\) != 443/);
  assert.match(addedPatch, /"\/app\/chat"\.equals\(pagePath\)/);
  assert.match(addedPatch, /\.HealzUploadFileProvider/);
  assert.doesNotMatch(addedPatch, /endsWith\("healz\.ai"\)/);
  assert.match(addedPatch, /toLowerCase\(Locale\.ROOT\)/);
});

test('WebView handoff trusts only the observed multiple document chooser contracts', () => {
  assert.match(
    addedPatch,
    /private boolean isTrustedHealzDocumentChooser\(String\[\] acceptTypes, boolean allowMultiple\)/,
  );
  assert.match(
    addedPatch,
    /!isTrustedHealzDocumentChooser\(acceptTypes, allowMultiple\)/,
  );
  assert.match(
    addedPatch,
    /if \(!allowMultiple \|\| acceptTypes == null \|\| acceptTypes\.length == 0\)/,
  );
  assert.match(
    addedPatch,
    /if \(values\.size\(\) == 1\) \{\s*return "\*\/\*"\.equals\(values\.get\(0\)\);\s*\}/,
  );
  assert.match(
    addedPatch,
    /return values\.size\(\) == 2\s*&& values\.contains\("application\/pdf"\)\s*&& values\.contains\("image\/\*"\);/,
  );
  assert.doesNotMatch(addedPatch, /acceptsPdf|acceptsImages|acceptsMime/);
  assert.doesNotMatch(addedPatch, /values\.contains\("\*\/\*"\)/);
});

test('WebView handoff accepts only the explicit staged medical-document MIME allowlist', () => {
  const supportedMimeMethod = addedPatch.match(
    /private boolean isSupportedHealzMime\(String mimeType\) \{([\s\S]*?)\n\s{4}\}/,
  )?.[1];
  assert.ok(supportedMimeMethod, 'isSupportedHealzMime helper must remain in the patch');

  const supportedMimeValues = [
    ...supportedMimeMethod.matchAll(/"([^"]+)"\.equals\(mimeType\)/g),
  ].map((match) => match[1]);
  assert.deepEqual(supportedMimeValues, [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
  ]);
  assert.doesNotMatch(supportedMimeMethod, /startsWith\("image\/"\)/);
});

test('WebView patch preserves the stock picker fallback', () => {
  assert.match(patch, /startPhotoPickerIntent\(filePathCallback, acceptTypes, allowMultiple/);
});

test('share target accepts mixed batches but config blocks broad storage permissions', () => {
  const plugins = appConfig.expo.plugins as [string, Record<string, unknown>][];
  const sharing = plugins.find(([name]) => name === 'expo-sharing')?.[1] as {
    android: { multipleShareMimeTypes: string[] };
    ios: {
      activationRule: {
        supportsFileWithMaxCount: number;
        supportsImageWithMaxCount: number;
      };
      appGroupId: string;
      enabled: boolean;
      extensionBundleIdentifier: string;
    };
  };
  assert.ok(sharing.android.multipleShareMimeTypes.includes('*/*'));
  assert.ok(sharing.android.multipleShareMimeTypes.includes('application/pdf'));
  assert.ok(sharing.android.multipleShareMimeTypes.includes('image/*'));
  assert.equal(sharing.ios.enabled, true);
  assert.equal(sharing.ios.extensionBundleIdentifier, 'ai.healz.mobile.ShareExtension');
  assert.equal(sharing.ios.appGroupId, 'group.ai.healz.mobile');
  assert.deepEqual(sharing.ios.activationRule, {
    supportsImageWithMaxCount: 10,
    supportsFileWithMaxCount: 10,
  });

  assert.deepEqual(appConfig.expo.android.blockedPermissions.sort(), [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]);
  assert.equal(appConfig.expo.android.allowBackup, false);
  assert.equal(appConfig.expo.android.package, 'ai.healz.mobile');

  const buildProperties = plugins.find(([name]) => name === 'expo-build-properties')?.[1] as {
    android: { minSdkVersion: number; targetSdkVersion: number; usesCleartextTraffic: boolean };
    ios: { deploymentTarget: string };
  };
  assert.equal(buildProperties.ios.deploymentTarget, '18.4');
  assert.equal(buildProperties.android.minSdkVersion, 26);
  assert.equal(buildProperties.android.targetSdkVersion, 36);
  assert.equal(buildProperties.android.usesCleartextTraffic, false);
});

test('iOS share extension keeps colliding filenames distinct and preserves the visible original name', () => {
  assert.match(addedExpoSharingPatch, /CFBundleDisplayName: 'Healz'/);
  assert.match(
    addedExpoSharingPatch,
    /let originalName = url\.lastPathComponent\.isEmpty \? "document" : url\.lastPathComponent/,
  );
  assert.match(addedExpoSharingPatch, /let storedName = UUID\(\)\.uuidString/);
  assert.match(addedExpoSharingPatch, /originalName: originalName,/);
  assert.doesNotMatch(
    addedExpoSharingPatch,
    /if FileManager\.default\.fileExists\(atPath: destinationURL\.path\)/,
  );
});

test('iOS share extension handles each share once and launches only after persistence succeeds', () => {
  assert.match(expoSharingTemplate, /private var isHandlingShare = false/);
  assert.match(expoSharingTemplate, /guard !isHandlingShare else \{\s*return\s*\}/);
  assert.match(expoSharingTemplate, /isHandlingShare = true/);
  assert.match(
    expoSharingTemplate,
    /private func saveToUserDefaults\(_ payload: \[SharePayload\]\) -> Bool/,
  );
  assert.match(
    expoSharingTemplate,
    /guard !payload\.isEmpty else \{\s*close\(\)\s*return\s*\}\s*guard saveToUserDefaults\(payload\) else \{\s*cleanupPayloadFiles\(payload\)\s*close\(\)\s*return\s*\}\s*openParentApp\(\)/,
  );
  assert.match(expoSharingTemplate, /guard userDefaults\.synchronize\(\) else/);
});

test('iOS share extension removes only its regular App Group files after persistence failure', () => {
  assert.match(
    expoSharingTemplate,
    /private func cleanupPayloadFiles\(_ payload: \[SharePayload\]\)/,
  );
  assert.match(
    expoSharingTemplate,
    /case \.file, \.image, \.audio, \.video:\s*break\s*case \.text, \.url:\s*continue/,
  );
  assert.match(
    expoSharingTemplate,
    /containerURL\(forSecurityApplicationGroupIdentifier: appGroupId\)/,
  );
  assert.match(
    expoSharingTemplate,
    /resourceValues\(forKeys: \[\.isSymbolicLinkKey, \.isRegularFileKey\]\)/,
  );
  assert.match(expoSharingTemplate, /values\?\.isSymbolicLink != true/);
  assert.match(expoSharingTemplate, /values\?\.isRegularFile == true/);
  assert.match(
    expoSharingTemplate,
    /let canonicalFile = rawURL\.standardizedFileURL\.resolvingSymlinksInPath\(\)/,
  );
  assert.match(expoSharingTemplate, /canonicalFile\.path\.hasPrefix\(containerPrefix\)/);
  assert.match(expoSharingTemplate, /removeItem\(at: canonicalFile\)/);
  assert.doesNotMatch(expoSharingTemplate, /removeItem\(at: rawURL\)/);
});

test('iOS host and share extension reap only stale UUID transit files inside the App Group', () => {
  assert.match(iosNativeModule, /cleanupExpiredSharedSources\(now: now\)/);
  assert.match(iosNativeModule, /UUID\(uuidString: stem\) != nil/);
  assert.match(iosNativeModule, /values\?\.isRegularFile == true/);
  assert.match(iosNativeModule, /values\?\.isSymbolicLink != true/);
  assert.match(
    iosNativeModule,
    /now\.timeIntervalSince\(modified\) \* 1000 > Double\(cacheTTLMilliseconds\)/,
  );
  assert.match(iosNativeModule, /isDescendant\(file, of: container\)/);

  assert.match(expoSharingTemplate, /maxTransitFileAge: TimeInterval = 24 \* 60 \* 60/);
  assert.match(expoSharingTemplate, /cleanupExpiredAppGroupFiles\(\)/);
  assert.match(expoSharingTemplate, /UUID\(uuidString: stem\) != nil/);
  assert.match(expoSharingTemplate, /values\?\.isRegularFile == true/);
  assert.match(expoSharingTemplate, /values\?\.isSymbolicLink != true/);
  assert.match(expoSharingTemplate, /now\.timeIntervalSince\(modified\) > maxTransitFileAge/);
  assert.match(expoSharingTemplate, /canonicalFile\.path\.hasPrefix\(containerPrefix\)/);

  const copyIndex = expoSharingTemplate.indexOf(
    'try FileManager.default.copyItem(at: url, to: destinationURL)',
  );
  const arrivalTimeIndex = expoSharingTemplate.indexOf(
    '[.modificationDate: Date()]',
    copyIndex,
  );
  const copiedSizeIndex = expoSharingTemplate.indexOf(
    'guard let copiedSize = fileSize(at: destinationURL)',
    copyIndex,
  );
  assert.ok(copyIndex >= 0, 'the extension must create an owned transit copy');
  assert.ok(arrivalTimeIndex > copyIndex, 'the transit TTL must start after the copy arrives');
  assert.ok(copiedSizeIndex > arrivalTimeIndex, 'arrival time must be set before returning payload metadata');
});

test('iOS share extension rejects oversized inputs before copying or writing them', () => {
  assert.match(
    expoSharingTemplate,
    /private let maxSharedFileBytes: Int64 = 50 \* 1024 \* 1024/,
  );

  const sourceLimit = expoSharingTemplate.indexOf(
    'guard let sourceSize = fileSize(at: url), sourceSize <= maxSharedFileBytes else',
  );
  const sourceCopy = expoSharingTemplate.indexOf(
    'try FileManager.default.copyItem(at: url, to: destinationURL)',
  );
  assert.ok(sourceLimit >= 0, 'shared file size must be checked');
  assert.ok(sourceCopy > sourceLimit, 'shared file size must be checked before copying');

  const dataLimit = expoSharingTemplate.indexOf(
    'guard Int64(data.count) <= maxSharedFileBytes else',
  );
  const dataWrite = expoSharingTemplate.indexOf('try data.write(to: destinationURL)');
  assert.ok(dataLimit >= 0, 'shared data size must be checked');
  assert.ok(dataWrite > dataLimit, 'shared data size must be checked before writing');

  assert.doesNotMatch(
    expoSharingTemplate,
    /print\([^\n]*(?:\\\(error\\\)|url\.path|destinationURL\.path|appGroupId)/,
  );
});

test('private FileProvider exposes only the bounded pending directory', () => {
  assert.match(nativeManifest, /android:exported="false"/);
  assert.match(nativeManifest, /\$\{applicationId\}\.HealzUploadFileProvider/);
  assert.match(providerPaths, /<files-path name="healz_pending" path="healz-pending\/" \/>/);
  assert.doesNotMatch(providerPaths, /<(root-path|external-path|cache-path)/);
});

test('native importer streams into filesDir and validates content and ownership', () => {
  assert.match(nativeModule, /File\(context\.filesDir, "healz-pending"\)/);
  assert.match(nativeModule, /COPY_BUFFER_BYTES = 64 \* 1024/);
  assert.match(nativeModule, /copied > MAX_IMPORT_FILE_BYTES/);
  assert.match(nativeModule, /existingBatchBytes \+ copied > MAX_BATCH_BYTES/);
  assert.match(nativeModule, /header\.copyOfRange\(0, 5\).*"%PDF-"/s);
  assert.match(nativeModule, /compatibleBrand in HEIC_BRANDS/);
  assert.doesNotMatch(nativeModule, /HEIC_BRANDS = setOf\([^)]*"mif1"/s);
  assert.match(nativeModule, /file\.path\.startsWith\(itemDirectory\.path \+ File\.separator\)/);
  assert.match(nativeModule, /UUID\.fromString\(value\)/);
});

test('iOS importer accepts only regular non-symlink files copied into its App Group', () => {
  assert.match(iosNativeModule, /rawSource\.isFileURL/);
  assert.match(
    iosNativeModule,
    /Bundle\.main\.object\(forInfoDictionaryKey: "ExpoShareIntoAppGroupId"\)/,
  );
  assert.match(
    iosNativeModule,
    /containerURL\(forSecurityApplicationGroupIdentifier: appGroupId\)/,
  );
  assert.match(
    iosNativeModule,
    /resourceValues\(forKeys: \[\.isSymbolicLinkKey, \.isRegularFileKey\]\)/,
  );
  assert.match(iosNativeModule, /values\?\.isSymbolicLink != true/);
  assert.match(iosNativeModule, /values\?\.isRegularFile == true/);
  assert.match(iosNativeModule, /isDescendant\(canonicalSource, of: container\)/);
  assert.match(
    iosNativeModule,
    /defer \{\s*for source in shareSourcesToDelete \{\s*try\? fileManager\.removeItem\(at: source\)/s,
  );
});

test('iOS importer streams into protected private storage and derives type from bytes', () => {
  assert.match(iosNativeModule, /private let maxFiles = 10/);
  assert.match(iosNativeModule, /maxImportFileBytes: Int64 = 50 \* 1024 \* 1024/);
  assert.match(iosNativeModule, /maxUploadFileBytes: Int64 = 20 \* 1024 \* 1024/);
  assert.match(iosNativeModule, /maxBatchBytes: Int64 = 100 \* 1024 \* 1024/);
  assert.match(iosNativeModule, /copyBufferBytes = 64 \* 1024/);
  assert.match(iosNativeModule, /InputStream\(url: source\)/);
  assert.match(iosNativeModule, /copied > maxImportFileBytes/);
  assert.match(iosNativeModule, /existingBatchBytes \+ copied > maxBatchBytes/);
  assert.match(iosNativeModule, /appendingPathComponent\("healz-pending", isDirectory: true\)/);
  assert.match(iosNativeModule, /FileProtectionType\.complete/);
  assert.match(iosNativeModule, /values\.isExcludedFromBackup = true/);

  assert.match(iosNativeModule, /header\.starts\(with: Data\("%PDF-"\.utf8\)\)/);
  assert.match(iosNativeModule, /header\[0\] == 0xff && header\[1\] == 0xd8/);
  assert.match(iosNativeModule, /header\.starts\(with: pngMagic\)/);
  assert.match(iosNativeModule, /== "RIFF" && ascii\(header, 8\.\.<12\) == "WEBP"/);
  assert.match(iosNativeModule, /heicBrands\.contains\(brand\)/);
  assert.doesNotMatch(iosNativeModule, /heicBrands[^\n]*"mif1"/);
  assert.match(iosNativeModule, /detectedMime == expectedMime/);
});

test('iOS stage lifecycle uses one bounded TTL contract and never exposes arbitrary files', () => {
  assert.match(iosNativeModule, /cacheTTLMilliseconds: Int64 = 24 \* 60 \* 60 \* 1000/);
  assert.match(iosNativeModule, /private let stagedKey = "staged_files_v1"/);
  assert.match(iosNativeModule, /private let consumedNonceKey = "consumed_nonce"/);
  assert.match(iosNativeModule, /private let consumedAtKey = "consumed_at"/);
  assert.match(iosNativeModule, /guard inputs\.count <= maxFiles/);
  assert.match(iosNativeModule, /isDescendant\(file, of: itemDirectory\)/);
  assert.match(iosNativeModule, /actualSize <= maxUploadFileBytes/);
  assert.match(iosNativeModule, /batchBytes <= maxBatchBytes/);
  assert.match(iosNativeModule, /defaults\.set\(encoded, forKey: stagedKey\)/);
  assert.match(iosNativeModule, /NotificationCenter\.default\.post\(name: stageChangedNotification/);
});

test('iOS WebView bridge arms only from a trusted exact main-frame composer message', () => {
  assert.match(addedPatch, /HealzUploadChooserHandlerName = @"HealzUploadChooser"/);
  assert.match(addedPatch, /HealzUploadChooserArmTTL = 1\.5/);
  assert.match(addedPatch, /@available\(iOS 18\.4, \*\)/);
  assert.match(addedPatch, /message\.frameInfo\.isMainFrame/);
  assert.match(addedPatch, /healzUploadIsChatURL:message\.frameInfo\.request\.URL/);
  assert.match(addedPatch, /version\.integerValue == 1/);
  assert.match(addedPatch, /multiple\.boolValue/);
  assert.match(addedPatch, /\[accept isEqualToString:@"application\/pdf,image\/\*"\]/);
  assert.match(addedPatch, /\[accept isEqualToString:@"\*\/\*"\]/);
  assert.match(addedPatch, /\[path isEqualToString:_webView\.URL\.path\]/);
  assert.match(addedPatch, /\[self healzUploadHasValidStage\]/);
  assert.match(addedPatch, /_healzUploadChooserArmedUntil = .* \+ HealzUploadChooserArmTTL/);
});

test('iOS WebView bridge validates private staged files before one-shot consumption', () => {
  assert.match(addedPatch, /now - createdAt\.doubleValue \/ 1000\.0 > HealzUploadStageTTL/);
  assert.match(addedPatch, /files\.count > 10/);
  assert.match(addedPatch, /NSApplicationSupportDirectory/);
  assert.match(addedPatch, /URLByAppendingPathComponent:@"healz-pending"/);
  assert.match(addedPatch, /initWithUUIDString:identifier/);
  assert.match(addedPatch, /!url\.isFileURL/);
  assert.match(addedPatch, /URLByResolvingSymlinksInPath/);
  assert.match(addedPatch, /\[url\.path hasPrefix:itemPrefix\]/);
  assert.match(addedPatch, /size\.longLongValue > 20LL \* 1024LL \* 1024LL/);
  assert.match(addedPatch, /totalSize > 100LL \* 1024LL \* 1024LL/);
  assert.match(addedPatch, /\[self healzUploadIsSupportedMimeType:mimeType\]/);

  const consumedMarker = addedPatch.indexOf('[defaults setObject:nonce forKey:HealzUploadConsumedNonceKey]');
  const stagedRemoval = addedPatch.indexOf('[defaults removeObjectForKey:HealzUploadStagedKey]');
  assert.ok(consumedMarker >= 0, 'consumed marker must be persisted');
  assert.ok(stagedRemoval > consumedMarker, 'staged value must be removed after the consumed marker');
});

test('iOS WebView bridge preserves the system picker unless a valid staged batch exists', () => {
  assert.match(
    addedPatch,
    /if \(selector == openPanelSelector\) \{[\s\S]*return \[self healzUploadHasValidStage\];[\s\S]*return NO;/,
  );
  assert.match(addedPatch, /return \[super respondsToSelector:selector\]/);
  assert.match(addedPatch, /_webView\.UIDelegate = nil;\s*_webView\.UIDelegate = self;/s);
  assert.match(addedPatch, /_healzUploadChooserArmedUntil = 0/);
  assert.match(addedPatch, /!frame\.isMainFrame/);
  assert.match(addedPatch, /!parameters\.allowsMultipleSelection/);
  assert.match(addedPatch, /parameters\.allowsDirectories/);
  assert.match(addedPatch, /healzUploadStagedURLsConsuming:YES/);
});

test('native and TypeScript separate local preparation and Healz upload limits', () => {
  assert.match(runtimeConfig, /MAX_IMPORT_FILE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(nativeModule, /MAX_IMPORT_FILE_BYTES = 50L \* 1024L \* 1024L/);
  assert.match(runtimeConfig, /MAX_UPLOAD_FILE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(nativeModule, /MAX_UPLOAD_FILE_BYTES = 20L \* 1024L \* 1024L/);
  assert.match(runtimeConfig, /MAX_BATCH_BYTES = 100 \* 1024 \* 1024/);
  assert.match(nativeModule, /MAX_BATCH_BYTES = 100L \* 1024L \* 1024L/);
  assert.match(nativeModule, /metadata\.size > MAX_IMPORT_FILE_BYTES/);
  assert.match(nativeModule, /copied > MAX_IMPORT_FILE_BYTES/);
  assert.match(nativeModule, /source\.length\(\) > MAX_UPLOAD_FILE_BYTES/);
  assert.match(nativeModule, /actualSize <= MAX_UPLOAD_FILE_BYTES/);
});

test('React queue does not advertise an expired native stage', () => {
  assert.match(appSource, /if \(status\.state === 'none'\)/);
  assert.match(appSource, /queueRef\.current = \[\]/);
  assert.match(appSource, /Подготовленные файлы устарели/);
});

test('removing a staged item invalidates polling first and preserves handed-off bytes', () => {
  const removeFile = appSource.match(
    /const removeFile = useCallback\(\(id: string\) => \{([\s\S]*?)\n  \}, \[updateQueue, updateStage\]\);/,
  )?.[1];
  assert.ok(removeFile, 'removeFile callback must keep the stage-safe removal contract');

  const snapshotIndex = removeFile.indexOf('const previousStage = stageRef.current;');
  const resetIndex = removeFile.indexOf('updateStage(null);');
  const queueIndex = removeFile.indexOf('updateQueue(');
  const discardIndex = removeFile.indexOf('HealzUploadBridge.discardFiles([id])');
  assert.ok(snapshotIndex >= 0, 'the active stage must be captured before reset');
  assert.ok(resetIndex > snapshotIndex, 'the React stage must be reset after its status is captured');
  assert.ok(queueIndex > resetIndex, 'the poll guard must be invalidated before queue mutation');
  assert.ok(discardIndex > queueIndex, 'native discard must happen after the synchronous React reset');
  assert.match(removeFile, /if \(previousStage\?\.status === 'handedOff'\) return;/);
});

test('iOS alone receives the synchronous Healz file-input activation shim', () => {
  assert.match(appSource, /Platform\.OS === 'ios' \? iosFileInputActivationScript : undefined/);
  assert.match(appSource, /injectedJavaScriptBeforeContentLoaded=/);
});
