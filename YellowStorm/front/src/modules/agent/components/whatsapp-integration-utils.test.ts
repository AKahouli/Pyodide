import { describe, expect, it } from 'vitest';

import {
  formatPairingCodeDisplay,
  isWhatsAppConnected,
  isWhatsAppFailed,
  isWhatsAppNetworkError,
  isWhatsAppNotConnected,
  isWhatsAppPairing,
  normalizeQrDataUrl,
  resolveWhatsAppErrorMessage,
} from './whatsapp-integration-utils';

describe('whatsapp-integration-utils', () => {
  it('prefixes raw base64 QR payloads', () => {
    expect(normalizeQrDataUrl('abc')).toBe('data:image/png;base64,abc');
    expect(normalizeQrDataUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(normalizeQrDataUrl(undefined)).toBeUndefined();
  });

  it('formats 8-digit pairing codes', () => {
    expect(formatPairingCodeDisplay('12345678')).toBe('1234-5678');
    expect(formatPairingCodeDisplay('ABCD')).toBe('ABCD');
  });

  it('detects integration states', () => {
    expect(isWhatsAppConnected('CONNECTED')).toBe(true);
    expect(isWhatsAppPairing('PAIRING')).toBe(true);
    expect(isWhatsAppFailed('FAILED')).toBe(true);
    expect(isWhatsAppNotConnected(null)).toBe(true);
    expect(isWhatsAppNotConnected({ status: 'DISCONNECTED' })).toBe(true);
    expect(isWhatsAppNotConnected({ status: 'CONNECTED' })).toBe(false);
  });

  it('detects network errors and resolves user-facing message', () => {
    expect(isWhatsAppNetworkError('ERR_3219')).toBe(true);
    expect(isWhatsAppNetworkError('Cannot reach web.whatsapp.com from this server')).toBe(true);
    expect(isWhatsAppNetworkError('ECONNRESET')).toBe(true);
    expect(isWhatsAppNetworkError('Some other error')).toBe(false);

    expect(
      resolveWhatsAppErrorMessage('ERR_3219', 'Network unreachable'),
    ).toBe('Network unreachable');
    expect(resolveWhatsAppErrorMessage('Other error', 'Network unreachable')).toBe('Other error');
  });
});
