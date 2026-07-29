import { NativeModule, registerWebModule } from 'expo';

import type {
  ImportBatchResult,
  ImportedFile,
  PreparedFileInput,
  SharedFileInput,
  StageFileInput,
  StageResult,
  StageStatus,
} from './HealzUploadBridge.types';

class HealzUploadBridgeWebModule extends NativeModule {
  private unsupported(): never {
    throw new Error('HealzUploadBridge is only available in the native Android app.');
  }

  async importSharedFiles(_payloads: SharedFileInput[]): Promise<ImportBatchResult> {
    return this.unsupported();
  }

  async adoptPreparedFile(_input: PreparedFileInput): Promise<ImportedFile> {
    return this.unsupported();
  }

  async stageForWebView(_files: StageFileInput[]): Promise<StageResult> {
    return this.unsupported();
  }

  async getStageStatus(_nonce: string): Promise<StageStatus> {
    return this.unsupported();
  }

  async clearStage(): Promise<void> {
    return this.unsupported();
  }

  async discardFiles(_ids: string[]): Promise<void> {
    return this.unsupported();
  }

  async cleanupExpired(): Promise<void> {
    return this.unsupported();
  }
}

export default registerWebModule(HealzUploadBridgeWebModule, 'HealzUploadBridge');
