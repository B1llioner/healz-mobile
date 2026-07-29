import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImportedFile } from '../modules/healz-upload-bridge';
import {
  describeIssue,
  formatBytes,
  selectedFile,
  toStageInput,
  type QueuedFile,
} from '../src/files/model';

const original: ImportedFile = {
  id: '00000000-0000-0000-0000-000000000001',
  uri: 'file:///private/original.jpg',
  name: 'analysis.jpg',
  mimeType: 'image/jpeg',
  size: 2_000_000,
  kind: 'original',
};

const prepared: ImportedFile = {
  ...original,
  uri: 'file:///private/prepared/analysis.jpg',
  size: 1_000_000,
  kind: 'prepared',
};

function queueItem(useOriginal: boolean): QueuedFile {
  return {
    id: original.id,
    original,
    prepared,
    useOriginal,
    state: 'ready',
    note: null,
  };
}

test('selects the prepared artifact by default and preserves original fallback', () => {
  assert.equal(selectedFile(queueItem(false)), prepared);
  assert.equal(selectedFile(queueItem(true)), original);
});

test('creates a minimal stage record from the user-selected artifact', () => {
  assert.deepEqual(toStageInput(queueItem(false)), {
    id: original.id,
    uri: prepared.uri,
    name: prepared.name,
    mimeType: prepared.mimeType,
    size: prepared.size,
  });
});

test('formats byte counts for a compact review UI', () => {
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(2048), '2 КБ');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 МБ');
  assert.equal(formatBytes(12 * 1024 * 1024), '12 МБ');
});

test('adds the source name to a native import issue without exposing content', () => {
  assert.equal(
    describeIssue({ code: 'unsupported_type', name: 'scan.gif' }),
    'scan.gif: Поддерживаются PDF, JPEG, PNG, WebP и HEIC.',
  );
});
