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
  };
  assert.ok(sharing.android.multipleShareMimeTypes.includes('*/*'));
  assert.ok(sharing.android.multipleShareMimeTypes.includes('application/pdf'));
  assert.ok(sharing.android.multipleShareMimeTypes.includes('image/*'));

  assert.deepEqual(appConfig.expo.android.blockedPermissions.sort(), [
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]);
  assert.equal(appConfig.expo.android.allowBackup, false);
  assert.equal(appConfig.expo.android.package, 'ai.healz.mobile');

  const buildProperties = plugins.find(([name]) => name === 'expo-build-properties')?.[1] as {
    android: { minSdkVersion: number; targetSdkVersion: number; usesCleartextTraffic: boolean };
  };
  assert.equal(buildProperties.android.minSdkVersion, 26);
  assert.equal(buildProperties.android.targetSdkVersion, 36);
  assert.equal(buildProperties.android.usesCleartextTraffic, false);
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
