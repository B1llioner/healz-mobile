import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import HealzUploadBridge, {
  type ImportBatchResult,
} from '../../modules/healz-upload-bridge';
import { toSharedFileInputs } from './payloads';
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
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    const platform = Platform.OS;

    const drain = async () => {
      if (drainingRef.current) return;
      const payloads = Sharing.getSharedPayloads();
      if (payloads.length === 0) return;

      drainingRef.current = true;
      try {
        let importPayloads = payloads;
        if (platform === 'ios') {
          try {
            const resolved = await Sharing.getResolvedSharedPayloadsAsync();
            if (resolved.length > 0) importPayloads = resolved;
          } catch {
            // Raw file URLs remain usable if metadata resolution fails.
          }
        }
        const files = toSharedFileInputs(importPayloads, platform);

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
