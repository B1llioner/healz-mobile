import assert from 'node:assert/strict';
import test from 'node:test';

import fallbackBridge from '../modules/healz-upload-bridge/src/HealzUploadBridgeModule';

test('fallback bridge lifecycle methods are safe no-ops for unsupported platforms', async () => {
  await fallbackBridge.cleanupExpired();
  await fallbackBridge.clearStage();
  await fallbackBridge.discardFiles(['ignored']);
  assert.deepEqual(await fallbackBridge.getStageStatus('ignored'), {
    state: 'none',
    nonce: null,
  });
});

test('fallback bridge share mutations fail explicitly instead of pretending to upload', async () => {
  await assert.rejects(
    fallbackBridge.importSharedFiles([]),
    /Incoming document sharing is not available on this platform yet/,
  );
  await assert.rejects(
    fallbackBridge.stageForWebView([]),
    /Incoming document sharing is not available on this platform yet/,
  );
});
