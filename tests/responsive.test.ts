import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clamp,
  createResponsiveLayout,
  interpolateClamped,
} from '../src/ui/responsive';

function assertClose(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('clamp keeps values inside an inclusive numerical range', () => {
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(4.5, 0, 10), 4.5);
  assert.equal(clamp(10, 0, 10), 10);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(Number.NEGATIVE_INFINITY, 0, 10), 0);
  assert.equal(clamp(Number.POSITIVE_INFINITY, 0, 10), 10);
});

test('interpolateClamped is fluid in-range and fixed at both boundaries', () => {
  assert.equal(interpolateClamped(-50, 0, 100, 10, 20), 10);
  assert.equal(interpolateClamped(0, 0, 100, 10, 20), 10);
  assert.equal(interpolateClamped(50, 0, 100, 10, 20), 15);
  assert.equal(interpolateClamped(100, 0, 100, 10, 20), 20);
  assert.equal(interpolateClamped(150, 0, 100, 10, 20), 20);
  assert.equal(interpolateClamped(25, 0, 100, 20, 0), 15);
});

test('interpolateClamped safely falls back when its input interval is invalid', () => {
  assert.equal(interpolateClamped(50, 100, 100, 12, 24), 12);
  assert.equal(interpolateClamped(50, 100, 0, 12, 24), 12);
});

test('small phone uses minimum fluid metrics and stacks constrained controls', () => {
  const layout = createResponsiveLayout({
    width: 320,
    height: 568,
    fontScale: 1,
  });

  assert.equal(layout.windowWidth, 320);
  assert.equal(layout.windowHeight, 568);
  assert.equal(layout.usableWidth, 320);
  assert.equal(layout.usableHeight, 568);
  assert.equal(layout.gutter, 12);
  assert.equal(layout.spacing, 10);
  assert.equal(layout.sectionPadding, 12);
  assert.equal(layout.cardPadding, 12);
  assert.equal(layout.radius, 12);
  assert.equal(layout.previewWidth, 56);
  assert.equal(layout.previewHeight, 70);
  assert.equal(layout.titleSize, 20);
  assert.equal(layout.panelWidth, 320);
  assert.equal(layout.contentWidth, 296);
  assert.equal(layout.fileColumns, 1);
  assert.equal(layout.fileCardWidth, 296);
  assert.equal(layout.stackBanner, true);
  assert.equal(layout.stackModalHeader, true);
  assert.equal(layout.stackFileDetails, false);
  assert.equal(layout.compactHeight, true);
  assert.equal(layout.touchTarget, 48);
});

test('standard phone gets continuously interpolated spacing without structural inflation', () => {
  const layout = createResponsiveLayout({
    width: 390,
    height: 844,
    fontScale: 1,
    insets: { top: 47, bottom: 34 },
  });

  assert.equal(layout.usableWidth, 390);
  assert.equal(layout.usableHeight, 763);
  assertClose(layout.gutter, 13.875);
  assertClose(layout.spacing, 10.9375);
  assertClose(layout.sectionPadding, 13.25);
  assertClose(layout.cardPadding, 12.9375);
  assertClose(layout.radius, 12.9375);
  assertClose(layout.previewWidth, 58.5);
  assertClose(layout.previewHeight, 73.125);
  assertClose(layout.titleSize, 20.625);
  assertClose(layout.contentWidth, 362.25);
  assert.equal(layout.fileColumns, 1);
  assert.equal(layout.stackBanner, false);
  assert.equal(layout.stackModalHeader, false);
  assert.equal(layout.stackFileDetails, false);
  assert.equal(layout.compactHeight, false);
});

test('tablet and landscape windows cap readable content and enable a two-column grid', () => {
  const layout = createResponsiveLayout({
    width: 1366,
    height: 1024,
    fontScale: 1,
  });

  assert.equal(layout.gutter, 24);
  assert.equal(layout.spacing, 16);
  assert.equal(layout.sectionPadding, 20);
  assert.equal(layout.cardPadding, 18);
  assert.equal(layout.radius, 18);
  assert.equal(layout.previewWidth, 72);
  assert.equal(layout.previewHeight, 90);
  assert.equal(layout.titleSize, 24);
  assert.equal(layout.modalMaxWidth, 760);
  assert.equal(layout.panelWidth, 760);
  assert.equal(layout.contentWidth, 712);
  assert.equal(layout.readableWidth, 620);
  assert.equal(layout.noticeWidth, 620);
  assert.equal(layout.fileColumns, 2);
  assert.equal(layout.fileCardWidth, 348);
  assert.equal(layout.stackBanner, false);
  assert.equal(layout.compactHeight, false);
});

test('safe-area insets reduce usable geometry before fluid metrics are selected', () => {
  const layout = createResponsiveLayout({
    width: 500,
    height: 900,
    fontScale: 1,
    insets: { top: 40, right: 70, bottom: 30, left: 100 },
  });

  assert.equal(layout.windowWidth, 500);
  assert.equal(layout.windowHeight, 900);
  assert.equal(layout.usableWidth, 330);
  assert.equal(layout.usableHeight, 830);
  assertClose(layout.gutter, 12 + (10 / 448) * 12);
  assert.equal(layout.panelWidth, 330);
  assertClose(layout.contentWidth, 330 - layout.gutter * 2);
  assert.equal(layout.fileColumns, 1);
  assert.equal(layout.stackBanner, true);
});

test('font scale changes structural stacking while preserving bounded geometry', () => {
  const normalText = createResponsiveLayout({ width: 768, height: 900, fontScale: 1 });
  const largeText = createResponsiveLayout({ width: 768, height: 900, fontScale: 3 });

  assert.equal(normalText.fileColumns, 2);
  assert.equal(normalText.stackBanner, false);
  assert.equal(normalText.stackModalHeader, false);
  assert.equal(normalText.stackFileDetails, false);

  assert.equal(largeText.fontScale, 3);
  assert.equal(largeText.fileColumns, 1);
  assert.equal(largeText.stackBanner, false);
  assert.equal(largeText.stackModalHeader, false);
  assert.equal(largeText.stackFileDetails, false);
  assert.equal(largeText.panelWidth, normalText.panelWidth);
  assert.equal(largeText.contentWidth, normalText.contentWidth);

  const narrowLargeText = createResponsiveLayout({ width: 420, height: 900, fontScale: 10 });
  assert.equal(narrowLargeText.fontScale, 3);
  assert.equal(narrowLargeText.stackBanner, true);
  assert.equal(narrowLargeText.stackModalHeader, true);
  assert.equal(narrowLargeText.stackFileDetails, true);
});

test('invalid dimensions, font scales, and insets normalize to safe boundaries', () => {
  const nonFinite = createResponsiveLayout({
    width: Number.NaN,
    height: Number.POSITIVE_INFINITY,
    fontScale: Number.NaN,
    insets: {
      top: Number.NaN,
      right: Number.POSITIVE_INFINITY,
      bottom: -50,
      left: -10,
    },
  });

  assert.equal(nonFinite.windowWidth, 390);
  assert.equal(nonFinite.windowHeight, 844);
  assert.equal(nonFinite.fontScale, 1);
  assert.equal(nonFinite.usableWidth, 390);
  assert.equal(nonFinite.usableHeight, 844);

  const undersized = createResponsiveLayout({
    width: -100,
    height: 0,
    fontScale: 0,
    insets: { top: 999, right: 999, bottom: 999, left: 999 },
  });

  assert.equal(undersized.windowWidth, 240);
  assert.equal(undersized.windowHeight, 320);
  assert.equal(undersized.fontScale, 0.8);
  assert.equal(undersized.usableWidth, 240);
  assert.equal(undersized.usableHeight, 320);
  assert.equal(undersized.panelWidth, 240);
  assert.ok(undersized.contentWidth > 0);
  assert.equal(undersized.compactHeight, true);
});
