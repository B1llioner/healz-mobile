import {
  MAX_BATCH_BYTES,
  MAX_IMPORT_FILE_BYTES,
  MAX_FILES,
  MAX_IMAGE_EDGE,
  MIN_SAVINGS_RATIO,
  MAX_UPLOAD_FILE_BYTES,
} from '../config';

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

export type ImagePreparationPlan =
  | { action: 'pass'; reason: 'already_small' | 'already_compressed' }
  | {
      action: 'prepare';
      outputMimeType: 'image/jpeg' | 'image/png';
      outputExtension: 'jpg' | 'png';
      quality: number;
      resizeLongEdge: number | null;
      compatibilityConversion: boolean;
    };

export function planImagePreparation(input: {
  mimeType: ImageMimeType;
  size: number;
  width: number;
  height: number;
}): ImagePreparationPlan {
  const longEdge = Math.max(input.width, input.height);
  const resizeLongEdge = longEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE : null;

  if (input.mimeType === 'image/webp') {
    return { action: 'pass', reason: 'already_compressed' };
  }

  if (input.mimeType === 'image/heic') {
    return {
      action: 'prepare',
      outputMimeType: 'image/jpeg',
      outputExtension: 'jpg',
      quality: 0.92,
      resizeLongEdge,
      compatibilityConversion: true,
    };
  }

  const smallEnough = input.mimeType === 'image/jpeg'
    ? input.size <= 2 * 1024 * 1024
    : input.size <= 4 * 1024 * 1024;
  if (resizeLongEdge == null && smallEnough) {
    return { action: 'pass', reason: 'already_small' };
  }

  return input.mimeType === 'image/png'
    ? {
        action: 'prepare',
        outputMimeType: 'image/png',
        outputExtension: 'png',
        quality: 1,
        resizeLongEdge,
        compatibilityConversion: false,
      }
    : {
        action: 'prepare',
        outputMimeType: 'image/jpeg',
        outputExtension: 'jpg',
        quality: 0.9,
        resizeLongEdge,
        compatibilityConversion: false,
      };
}

export function shouldUsePreparedFile(input: {
  originalBytes: number;
  preparedBytes: number;
  compatibilityConversion: boolean;
}): boolean {
  if (input.compatibilityConversion) return true;
  if (input.originalBytes <= 0 || input.preparedBytes <= 0) return false;
  if (
    input.originalBytes > MAX_UPLOAD_FILE_BYTES
    && input.preparedBytes <= MAX_UPLOAD_FILE_BYTES
  ) return true;
  return input.preparedBytes <= input.originalBytes * (1 - MIN_SAVINGS_RATIO);
}

export function canAppendToQueue(input: {
  currentCount: number;
  currentBytes: number;
  nextBytes: number;
}): boolean {
  if (input.nextBytes < 0 || input.nextBytes > MAX_IMPORT_FILE_BYTES) return false;
  return input.currentCount < MAX_FILES && input.currentBytes + input.nextBytes <= MAX_BATCH_BYTES;
}
