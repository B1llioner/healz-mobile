import type {
  ImportBatchResult,
  ImportedFile,
  PreparedFileInput,
  SharedFileInput,
  StageFileInput,
  StageResult,
  StageStatus,
} from './HealzUploadBridge.types';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error('Incoming document sharing is not available on this platform yet.'));
}

export default {
  importSharedFiles(_payloads: SharedFileInput[]): Promise<ImportBatchResult> {
    return unsupported();
  },
  adoptPreparedFile(_input: PreparedFileInput): Promise<ImportedFile> {
    return unsupported();
  },
  stageForWebView(_files: StageFileInput[]): Promise<StageResult> {
    return unsupported();
  },
  getStageStatus(_nonce: string): Promise<StageStatus> {
    return Promise.resolve({ state: 'none', nonce: null });
  },
  clearStage(): Promise<void> {
    return Promise.resolve();
  },
  discardFiles(_ids: string[]): Promise<void> {
    return Promise.resolve();
  },
  cleanupExpired(): Promise<void> {
    return Promise.resolve();
  },
};
