import { HEALZ_ORIGIN } from '../config';

export type NavigationDecision = 'internal' | 'external' | 'blocked';

const INTERNAL_ORIGIN = new URL(HEALZ_ORIGIN);
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function classifyNavigation(rawUrl: string): NavigationDecision {
  if (rawUrl === 'about:blank') return 'internal';

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'blocked';
  }

  if (
    url.protocol === INTERNAL_ORIGIN.protocol &&
    url.hostname === INTERNAL_ORIGIN.hostname &&
    url.port === INTERNAL_ORIGIN.port
  ) {
    return 'internal';
  }

  return EXTERNAL_SCHEMES.has(url.protocol) ? 'external' : 'blocked';
}

export function isIncomingShareLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'healz:' && url.hostname === 'expo-sharing';
  } catch {
    return false;
  }
}
