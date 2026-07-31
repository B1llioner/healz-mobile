import assert from 'node:assert/strict';
import test from 'node:test';

import { toSharedFileInputs } from '../src/share/payloads';

test('maps Android file and image shares from content URIs', () => {
  assert.deepEqual(toSharedFileInputs([
    {
      value: 'content://mail.provider/analysis.pdf',
      shareType: 'file',
      mimeType: 'application/pdf',
    },
    {
      contentUri: 'content://photos.provider/lab-result',
      contentMimeType: 'image/heic',
      mimeType: 'application/octet-stream',
      originalName: 'IMG_0042.HEIC',
      shareType: 'image',
      value: 'ignored-when-resolved-content-uri-exists',
    },
  ], 'android'), [
    {
      displayName: undefined,
      mimeType: 'application/pdf',
      uri: 'content://mail.provider/analysis.pdf',
    },
    {
      displayName: 'IMG_0042.HEIC',
      mimeType: 'image/heic',
      uri: 'content://photos.provider/lab-result',
    },
  ]);
});

test('maps iOS extension files and preserves resolved original metadata', () => {
  assert.deepEqual(toSharedFileInputs([
    {
      contentMimeType: 'image/jpeg',
      contentUri: 'file:///private/app-group/uuid.jpg',
      originalName: 'blood work 2026.jpg',
      shareType: 'image',
      value: 'file:///private/app-group/raw-share-name.jpg',
    },
    {
      shareType: 'file',
      value: 'file:///private/app-group/report.pdf',
    },
  ], 'ios'), [
    {
      displayName: 'blood work 2026.jpg',
      mimeType: 'image/jpeg',
      uri: 'file:///private/app-group/uuid.jpg',
    },
    {
      displayName: undefined,
      mimeType: 'application/octet-stream',
      uri: 'file:///private/app-group/report.pdf',
    },
  ]);
});

test('routes unsupported iOS file-backed media through native cleanup without widening Android', () => {
  const payloads = [
    {
      shareType: 'audio',
      value: 'file:///private/group/voice.m4a',
      mimeType: 'audio/mp4',
    },
    {
      shareType: 'video',
      value: 'file:///private/group/clip.mov',
      mimeType: 'video/quicktime',
    },
  ];

  assert.equal(toSharedFileInputs(payloads, 'ios').length, 2);
  assert.deepEqual(toSharedFileInputs(payloads, 'android'), []);
});

test('rejects text, URLs, missing values, and cross-platform URI schemes', () => {
  const payloads = [
    { shareType: 'text', value: 'content://provider/text' },
    { shareType: 'url', value: 'file:///private/link' },
    { shareType: 'file' },
    { shareType: 'file', value: 'https://app.healz.ai/document.pdf' },
  ];

  assert.deepEqual(toSharedFileInputs([
    ...payloads,
    { shareType: 'image', value: 'file:///private/android-mismatch.jpg' },
  ], 'android'), []);
  assert.deepEqual(toSharedFileInputs([
    ...payloads,
    { shareType: 'image', value: 'content://provider/ios-mismatch' },
  ], 'ios'), []);
});

test('fails closed when a resolved URI exists but has the wrong scheme', () => {
  assert.deepEqual(toSharedFileInputs([{
    contentUri: 'file:///private/not-an-android-provider.pdf',
    shareType: 'file',
    value: 'content://provider/fallback-must-not-be-used',
  }], 'android'), []);

  assert.deepEqual(toSharedFileInputs([{
    contentUri: 'content://provider/not-an-ios-file',
    shareType: 'file',
    value: 'file:///private/fallback-must-not-be-used.pdf',
  }], 'ios'), []);
});
