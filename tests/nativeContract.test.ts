import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const patch = readFileSync(
  new URL('../patches/react-native-webview+13.16.1.patch', import.meta.url),
  'utf8',
);
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

test('WebView handoff is pinned to exact HTTPS host, chat path, and private provider', () => {
  assert.match(patch, /!"https"\.equals\(pageUri\.getScheme\(\)\)/);
  assert.match(patch, /!"app\.healz\.ai"\.equals\(pageUri\.getHost\(\)\)/);
  assert.match(patch, /"\/app\/chat"\.equals\(pagePath\)/);
  assert.match(patch, /\.HealzUploadFileProvider/);
  assert.doesNotMatch(patch, /endsWith\("healz\.ai"\)/);
});

test('WebView patch preserves the stock picker fallback', () => {
  assert.match(patch, /startPhotoPickerIntent\(filePathCallback, acceptTypes, allowMultiple/);
  assert.match(patch, /acceptsPdf && acceptsImages && acceptsMime/);
  assert.doesNotMatch(patch, /"application\/pdf"\.equals\(value\) \|\| "image\/\*"\.equals\(value\)/);
  assert.match(patch, /files\.length\(\) > 1 && !allowMultiple/);
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
  assert.match(nativeModule, /copied > MAX_FILE_BYTES/);
  assert.match(nativeModule, /existingBatchBytes \+ copied > MAX_BATCH_BYTES/);
  assert.match(nativeModule, /header\.copyOfRange\(0, 5\).*"%PDF-"/s);
  assert.match(nativeModule, /compatibleBrand in HEIC_BRANDS/);
  assert.doesNotMatch(nativeModule, /HEIC_BRANDS = setOf\([^)]*"mif1"/s);
  assert.match(nativeModule, /file\.path\.startsWith\(itemDirectory\.path \+ File\.separator\)/);
  assert.match(nativeModule, /UUID\.fromString\(value\)/);
});
