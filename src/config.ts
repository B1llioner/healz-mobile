export const HEALZ_ORIGIN = 'https://app.healz.ai';
export const HEALZ_START_URL = `${HEALZ_ORIGIN}/app/chat`;

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 3508;
export const MIN_SAVINGS_RATIO = 0.1;

export const COLORS = {
  background: '#FDF8F6',
  surface: '#FFFFFF',
  surfaceWarm: '#FAF5F3',
  text: '#2D262E',
  heading: '#1A1A1A',
  muted: '#6B6B6B',
  border: '#E7DADB',
  accent: '#B262C7',
  accentSoft: '#F1E1F5',
  danger: '#A63D54',
  success: '#317A58',
} as const;
