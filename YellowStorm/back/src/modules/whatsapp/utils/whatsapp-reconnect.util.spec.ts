import {
  resolveStatusAfterReconnectExhausted,
  shouldAutoReconnectAfterDisconnect,
} from './whatsapp-reconnect.util';

describe('whatsapp-reconnect.util', () => {
  describe('shouldAutoReconnectAfterDisconnect', () => {
    it('always retries while pairing', () => {
      expect(shouldAutoReconnectAfterDisconnect({ pairingMode: true, statusCode: 401 })).toBe(
        true,
      );
    });

    it('retries generic connection closed without status code', () => {
      expect(shouldAutoReconnectAfterDisconnect({ pairingMode: false })).toBe(true);
    });

    it('does not retry fatal disconnect reasons', () => {
      expect(shouldAutoReconnectAfterDisconnect({ pairingMode: false, statusCode: 440 })).toBe(
        false,
      );
    });
  });

  describe('resolveStatusAfterReconnectExhausted', () => {
    it('returns DISCONNECTED when transient reconnect was attempted', () => {
      expect(resolveStatusAfterReconnectExhausted({ pairingMode: false })).toBe('DISCONNECTED');
    });
  });
});
