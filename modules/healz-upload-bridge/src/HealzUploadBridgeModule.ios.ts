import { NativeModule, requireNativeModule } from 'expo';

import type {
  ImportBatchResult,
  ImportedFile,
  PreparedFileInput,
  SharedFileInput,
  StageFileInput,
  StageResult,
  StageStatus,
} from './HealzUploadBridge.types';

declare class HealzUploadBridgeNativeModule extends NativeModule {
  importSharedFiles(payloads: SharedFileInput[]): Promise<ImportBatchResult>;
  adoptPreparedFile(input: PreparedFileInput): Promise<ImportedFile>;
  stageForWebView(files: StageFileInput[]): Promise<StageResult>;
  getStageStatus(nonce: string): Promise<StageStatus>;
  clearStage(): Promise<void>;
  discardFiles(ids: string[]): Promise<void>;
  cleanupExpired(): Promise<void>;
}

export default requireNativeModule<HealzUploadBridgeNativeModule>('HealzUploadBridge');
