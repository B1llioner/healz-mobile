import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyNavigation, isIncomingShareLink } from '../src/web/urlPolicy';

test('keeps only the exact secure Healz origin inside WebView', () => {
  assert.equal(classifyNavigation('https://app.healz.ai/app/chat'), 'internal');
  assert.equal(classifyNavigation('https://app.healz.ai/app/chat?id=1#composer'), 'internal');
  assert.equal(classifyNavigation('about:blank'), 'internal');
});

test('does not trust lookalike hosts, subdomains, ports, or cleartext Healz', () => {
  assert.equal(classifyNavigation('https://app.healz.ai.evil.example/app/chat'), 'external');
  assert.equal(classifyNavigation('https://cdn.app.healz.ai/file'), 'external');
  assert.equal(classifyNavigation('https://app.healz.ai:8443/app/chat'), 'external');
  assert.equal(classifyNavigation('http://app.healz.ai/app/chat'), 'external');
});

test('opens normal external links systemically and blocks dangerous schemes', () => {
  assert.equal(classifyNavigation('https://example.org/help'), 'external');
  assert.equal(classifyNavigation('mailto:support@example.org'), 'external');
  assert.equal(classifyNavigation('tel:+10000000000'), 'external');
  assert.equal(classifyNavigation('javascript:alert(1)'), 'blocked');
  assert.equal(classifyNavigation('data:text/html,hello'), 'blocked');
  assert.equal(classifyNavigation('file:///tmp/document.pdf'), 'blocked');
  assert.equal(classifyNavigation('content://provider/private'), 'blocked');
  assert.equal(classifyNavigation('not a url'), 'blocked');
});

test('recognizes only the expo-sharing deep link for this app', () => {
  assert.equal(isIncomingShareLink('healz://expo-sharing'), true);
  assert.equal(isIncomingShareLink('healz://expo-sharing/path'), true);
  assert.equal(isIncomingShareLink('healz://other'), false);
  assert.equal(isIncomingShareLink('https://expo-sharing'), false);
});
