import type { SharedFileInput } from '../../modules/healz-upload-bridge';

export type IncomingSharePlatform = 'android' | 'ios';

type RawSharePayload = {
  value?: string;
  shareType?: string;
  mimeType?: string;
  contentUri?: string | null;
  contentMimeType?: string | null;
  originalName?: string | null;
};

function hasExpectedScheme(value: string, platform: IncomingSharePlatform): boolean {
  return platform === 'android'
    ? value.startsWith('content://')
    : value.startsWith('file://');
}

function isFileBackedShare(shareType: string | undefined, platform: IncomingSharePlatform): boolean {
  if (shareType === 'file' || shareType === 'image') return true;

  // The iOS extension can still receive an out-of-contract audio/video item
  // from a third-party share sheet. Route its App Group file through the Swift
  // importer so the magic check rejects it and the owned transit copy is
  // deleted. Android URIs are not owned by us and remain restricted to the
  // configured file/image contract.
  return platform === 'ios' && (shareType === 'audio' || shareType === 'video');
}

/**
 * Converts OS-provided file/media payloads into the small native import
 * contract. Names, sizes, and the real MIME type are deliberately derived
 * from the copied bytes by the platform module instead of being trusted here.
 * Unsupported iOS file-backed media is intentionally included so the native
 * owner can reject it and securely delete its App Group transit copy.
 */
export function toSharedFileInputs(
  payloads: readonly RawSharePayload[],
  platform: IncomingSharePlatform,
): SharedFileInput[] {
  return payloads.flatMap((payload) => {
    const uri = payload.contentUri ?? payload.value;
    if (
      !isFileBackedShare(payload.shareType, platform)
      || typeof uri !== 'string'
      || !hasExpectedScheme(uri, platform)
    ) {
      return [];
    }

    return [{
      uri,
      mimeType: payload.contentMimeType ?? payload.mimeType ?? 'application/octet-stream',
      displayName: payload.originalName,
    }];
  });
}
