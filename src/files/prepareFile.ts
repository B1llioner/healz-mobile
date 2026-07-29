import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import HealzUploadBridge, {
  type ImportedFile,
  type SupportedMimeType,
} from '../../modules/healz-upload-bridge';
import {
  MAX_IMAGE_EDGE,
} from '../config';
import type { PreparationResult } from './model';
import {
  planImagePreparation,
  shouldUsePreparedFile,
  type ImageMimeType,
} from './policy';

type ImageDimensions = { width: number; height: number };

function getImageDimensions(uri: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

function replaceExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'document';
  return `${base}.${extension}`;
}

export async function prepareImportedFile(
  file: ImportedFile,
): Promise<PreparationResult> {
  if (file.mimeType === 'application/pdf') {
    return {
      prepared: null,
      note: 'PDF будет отправлен без изменений: так сохраняются текст, формы и подписи.',
    };
  }

  if (file.mimeType === 'image/webp') {
    return {
      prepared: null,
      note: 'WebP уже эффективно сжат; используем оригинал.',
    };
  }

  try {
    const dimensions = await getImageDimensions(file.uri);
    const plan = planImagePreparation({
      mimeType: file.mimeType as ImageMimeType,
      size: file.size,
      ...dimensions,
    });
    if (plan.action === 'pass') {
      return { prepared: null, note: 'Оригинал уже достаточно компактный.' };
    }

    const context = ImageManipulator.manipulate(file.uri);
    if (plan.resizeLongEdge != null) {
      context.resize(
        dimensions.width >= dimensions.height
          ? { width: MAX_IMAGE_EDGE, height: null }
          : { width: null, height: MAX_IMAGE_EDGE },
      );
    }

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: plan.outputMimeType === 'image/png' ? SaveFormat.PNG : SaveFormat.JPEG,
      compress: plan.quality,
    });
    const prepared = await HealzUploadBridge.adoptPreparedFile({
      id: file.id,
      sourceUri: saved.uri,
      name: replaceExtension(file.name, plan.outputExtension),
      mimeType: plan.outputMimeType as SupportedMimeType,
    });

    if (!shouldUsePreparedFile({
      originalBytes: file.size,
      preparedBytes: prepared.size,
      compatibilityConversion: plan.compatibilityConversion,
    })) {
      return {
        prepared: null,
        note: 'Оптимизация почти не уменьшила файл; используем оригинал.',
      };
    }

    return {
      prepared,
      note: plan.compatibilityConversion
        ? 'HEIC преобразован в совместимый JPEG без агрессивной обработки.'
        : 'Размер уменьшен без изменения содержимого документа.',
    };
  } catch {
    return {
      prepared: null,
      note: 'Не удалось безопасно оптимизировать; будет отправлен оригинал.',
    };
  }
}
