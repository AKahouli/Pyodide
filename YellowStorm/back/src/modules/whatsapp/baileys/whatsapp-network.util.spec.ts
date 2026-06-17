import { isWhatsAppTransportError } from './whatsapp-network.util';

describe('isWhatsAppTransportError', () => {
  it('detects common network transport failures', () => {
    expect(isWhatsAppTransportError('read ECONNRESET')).toBe(true);
    expect(isWhatsAppTransportError('connect ETIMEDOUT')).toBe(true);
    expect(isWhatsAppTransportError('getaddrinfo ENOTFOUND web.whatsapp.com')).toBe(true);
    expect(isWhatsAppTransportError('socket hang up')).toBe(true);
    expect(isWhatsAppTransportError('Network unreachable')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isWhatsAppTransportError('Invalid session')).toBe(false);
    expect(isWhatsAppTransportError('HTTP 401 Unauthorized')).toBe(false);
  });
});
