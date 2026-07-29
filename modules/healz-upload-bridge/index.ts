// Re-export the native module. On web, it will be resolved to HealzUploadBridgeModule.web.ts
// and on native platforms to HealzUploadBridgeModule.ts
export { default } from './src/HealzUploadBridgeModule';
export * from './src/HealzUploadBridge.types';
