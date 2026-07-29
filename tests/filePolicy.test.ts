import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAppendToQueue,
  planImagePreparation,
  shouldUsePreparedFile,
} from '../src/files/policy';

test('passes through a small JPEG without recompression', () => {
  assert.deepEqual(
    planImagePreparation({
      mimeType: 'image/jpeg',
      size: 1_000_000,
      width: 1800,
      height: 2400,
    }),
    { action: 'pass', reason: 'already_small' },
  );
});

test('resizes a large JPEG with the medical-document quality floor', () => {
  assert.deepEqual(
    planImagePreparation({
      mimeType: 'image/jpeg',
      size: 12_000_000,
      width: 5000,
      height: 3500,
    }),
    {
      action: 'prepare',
      outputMimeType: 'image/jpeg',
      outputExtension: 'jpg',
      quality: 0.9,
      resizeLongEdge: 3508,
      compatibilityConversion: false,
    },
  );
});

test('keeps PNG lossless and only schedules the required resize', () => {
  const plan = planImagePreparation({
    mimeType: 'image/png',
    size: 8_000_000,
    width: 2400,
    height: 3200,
  });
  assert.equal(plan.action, 'prepare');
  if (plan.action === 'prepare') {
    assert.equal(plan.outputMimeType, 'image/png');
    assert.equal(plan.quality, 1);
    assert.equal(plan.resizeLongEdge, null);
  }
});

test('always converts HEIC for upload compatibility', () => {
  assert.deepEqual(
    planImagePreparation({
      mimeType: 'image/heic',
      size: 900_000,
      width: 1200,
      height: 1600,
    }),
    {
      action: 'prepare',
      outputMimeType: 'image/jpeg',
      outputExtension: 'jpg',
      quality: 0.92,
      resizeLongEdge: null,
      compatibilityConversion: true,
    },
  );
});

test('passes WebP through because it is already compressed', () => {
  assert.deepEqual(
    planImagePreparation({
      mimeType: 'image/webp',
      size: 7_000_000,
      width: 5000,
      height: 5000,
    }),
    { action: 'pass', reason: 'already_compressed' },
  );
});

test('requires at least ten percent savings except compatibility conversion', () => {
  assert.equal(
    shouldUsePreparedFile({ originalBytes: 1000, preparedBytes: 900, compatibilityConversion: false }),
    true,
  );
  assert.equal(
    shouldUsePreparedFile({ originalBytes: 1000, preparedBytes: 901, compatibilityConversion: false }),
    false,
  );
  assert.equal(
    shouldUsePreparedFile({ originalBytes: 1000, preparedBytes: 1200, compatibilityConversion: true }),
    true,
  );
  assert.equal(
    shouldUsePreparedFile({ originalBytes: 0, preparedBytes: 0, compatibilityConversion: false }),
    false,
  );
});

test('enforces queue count and batch byte limits at the boundary', () => {
  assert.equal(canAppendToQueue({ currentCount: 0, currentBytes: 0, nextBytes: 50 * 1024 * 1024 }), true);
  assert.equal(canAppendToQueue({ currentCount: 0, currentBytes: 0, nextBytes: 50 * 1024 * 1024 + 1 }), false);
  assert.equal(canAppendToQueue({ currentCount: 9, currentBytes: 99 * 1024 * 1024, nextBytes: 1024 * 1024 }), true);
  assert.equal(canAppendToQueue({ currentCount: 10, currentBytes: 0, nextBytes: 1 }), false);
  assert.equal(canAppendToQueue({ currentCount: 1, currentBytes: 100 * 1024 * 1024, nextBytes: 1 }), false);
  assert.equal(canAppendToQueue({ currentCount: 0, currentBytes: 0, nextBytes: -1 }), false);
});
