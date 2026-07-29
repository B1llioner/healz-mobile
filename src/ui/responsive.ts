export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ResponsiveInput = {
  width: number;
  height: number;
  fontScale: number;
  insets?: Partial<SafeAreaInsets>;
};

export type ResponsiveLayout = {
  windowWidth: number;
  windowHeight: number;
  usableWidth: number;
  usableHeight: number;
  fontScale: number;
  gutter: number;
  spacing: number;
  sectionPadding: number;
  cardPadding: number;
  radius: number;
  previewWidth: number;
  previewHeight: number;
  titleSize: number;
  touchTarget: number;
  modalMaxWidth: number;
  panelWidth: number;
  contentWidth: number;
  readableWidth: number;
  noticeWidth: number;
  fileColumns: 1 | 2;
  fileCardWidth: number;
  stackBanner: boolean;
  stackModalHeader: boolean;
  stackFileDetails: boolean;
  compactHeight: boolean;
};

const MIN_WINDOW_WIDTH = 240;
const MIN_WINDOW_HEIGHT = 320;
const PHONE_REFERENCE_WIDTH = 390;
const FLUID_MIN_WIDTH = 320;
const FLUID_MAX_WIDTH = 768;
const MODAL_MAX_WIDTH = 760;
const READABLE_MAX_WIDTH = 620;
const WIDE_GRID_MIN_CONTENT_WIDTH = 680;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function interpolateClamped(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
): number {
  if (inputMaximum <= inputMinimum) return outputMinimum;
  const progress = clamp(
    (value - inputMinimum) / (inputMaximum - inputMinimum),
    0,
    1,
  );
  return outputMinimum + (outputMaximum - outputMinimum) * progress;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeInset(value: number | undefined): number {
  return Math.max(0, finiteOr(value, 0));
}

/**
 * Produces continuous layout values from the actual application window.
 *
 * Numerical values use clamped interpolation, so spacing grows smoothly without
 * making small phones cramped or tablets cartoonishly large. Structural changes
 * remain discrete: controls stack only when their measured width/font budget no
 * longer fits, and document cards become a two-column grid only with enough room.
 */
export function createResponsiveLayout(input: ResponsiveInput): ResponsiveLayout {
  const windowWidth = Math.max(MIN_WINDOW_WIDTH, finiteOr(input.width, PHONE_REFERENCE_WIDTH));
  const windowHeight = Math.max(MIN_WINDOW_HEIGHT, finiteOr(input.height, 844));
  const fontScale = clamp(finiteOr(input.fontScale, 1), 0.8, 3);
  const leftInset = normalizeInset(input.insets?.left);
  const rightInset = normalizeInset(input.insets?.right);
  const topInset = normalizeInset(input.insets?.top);
  const bottomInset = normalizeInset(input.insets?.bottom);

  const usableWidth = Math.max(MIN_WINDOW_WIDTH, windowWidth - leftInset - rightInset);
  const usableHeight = Math.max(MIN_WINDOW_HEIGHT, windowHeight - topInset - bottomInset);
  const gutter = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 12, 24);
  const spacing = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 10, 16);
  const sectionPadding = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 12, 20);
  const cardPadding = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 12, 18);
  const radius = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 12, 18);
  const previewWidth = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 56, 72);
  const titleSize = interpolateClamped(usableWidth, FLUID_MIN_WIDTH, FLUID_MAX_WIDTH, 20, 24);
  const panelWidth = Math.min(usableWidth, MODAL_MAX_WIDTH);
  const contentWidth = Math.max(1, panelWidth - gutter * 2);
  const readableWidth = Math.min(contentWidth, READABLE_MAX_WIDTH);

  const largeTextWidthPenalty = clamp((fontScale - 1) * 90, 0, 180);
  const stackBanner = usableWidth - largeTextWidthPenalty < PHONE_REFERENCE_WIDTH;
  const stackModalHeader = contentWidth - largeTextWidthPenalty < 300;
  const stackFileDetails = contentWidth - largeTextWidthPenalty < 250;
  const fileColumns = contentWidth >= WIDE_GRID_MIN_CONTENT_WIDTH && fontScale < 1.3 ? 2 : 1;
  const fileCardWidth = fileColumns === 2
    ? (contentWidth - spacing) / 2
    : contentWidth;

  return {
    windowWidth,
    windowHeight,
    usableWidth,
    usableHeight,
    fontScale,
    gutter,
    spacing,
    sectionPadding,
    cardPadding,
    radius,
    previewWidth,
    previewHeight: previewWidth * 1.25,
    titleSize,
    touchTarget: 48,
    modalMaxWidth: MODAL_MAX_WIDTH,
    panelWidth,
    contentWidth,
    readableWidth,
    noticeWidth: readableWidth,
    fileColumns,
    fileCardWidth,
    stackBanner,
    stackModalHeader,
    stackFileDetails,
    compactHeight: usableHeight < 600,
  };
}
