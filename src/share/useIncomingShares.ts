import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import HealzUploadBridge, {
  type ImportBatchResult,
  type SharedFileInput,
} from '../../modules/healz-upload-bridge';
import { isIncomingShareLink } from '../web/urlPolicy';

type UseIncomingSharesOptions = {
  onBatch: (result: ImportBatchResult) => void;
  onError: (message: string) => void;
};

export function useIncomingShares({ onBatch, onError }: UseIncomingSharesOptions): void {
  const onBatchRef = useRef(onBatch);
  const onErrorRef = useRef(onError);
  const drainingRef = useRef(false);

  onBatchRef.current = onBatch;
  onErrorRef.current = onError;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const drain = async () => {
      if (drainingRef.current) return;
      const payloads = Sharing.getSharedPayloads();
      if (payloads.length === 0) return;

      drainingRef.current = true;
      try {
        const files: SharedFileInput[] = payloads
          .filter(
            (payload) =>
              (payload.shareType === 'file' || payload.shareType === 'image') &&
              typeof payload.value === 'string' &&
              payload.value.startsWith('content://'),
          )
          .map((payload) => ({
            uri: payload.value ?? '',
            mimeType: payload.mimeType ?? 'application/octet-stream',
          }));

        if (files.length === 0) {
          Sharing.clearSharedPayloads();
          onErrorRef.current('Healz принимает из меню «Поделиться» только PDF и изображения.');
          return;
        }

        const result = await HealzUploadBridge.importSharedFiles(files);
        Sharing.clearSharedPayloads();
        onBatchRef.current(result);
      } catch {
        onErrorRef.current(
          'Не удалось создать защищённую копию. Исходный файл не изменён — попробуйте поделиться им ещё раз.',
        );
      } finally {
        drainingRef.current = false;
      }
    };

    void drain();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void drain();
    });
    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      if (isIncomingShareLink(url)) void drain();
    });

    return () => {
      appStateSubscription.remove();
      linkingSubscription.remove();
    };
  }, []);
}
