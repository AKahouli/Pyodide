/**
 * Baileys DisconnectReason values that require user action — no background reconnect.
 * @see @whiskeysockets/baileys DisconnectReason
 */
const FATAL_DISCONNECT_STATUS_CODES = new Set([
  401, // loggedOut
  403, // forbidden
  411, // multideviceMismatch
  440, // connectionReplaced
  500, // badSession
]);

/**
 * Whether to schedule an automatic socket reopen after connection.close.
 */
export function shouldAutoReconnectAfterDisconnect(params: {
  pairingMode: boolean;
  statusCode?: number;
}): boolean {
  if (params.pairingMode) {
    return true;
  }
  if (params.statusCode === undefined) {
    return true;
  }
  return !FATAL_DISCONNECT_STATUS_CODES.has(params.statusCode);
}

/**
 * After reconnect budget is exhausted, credentials may still be valid (transient outage).
 */
export function resolveStatusAfterReconnectExhausted(params: {
  pairingMode: boolean;
  statusCode?: number;
}): 'DISCONNECTED' | 'FAILED' {
  if (shouldAutoReconnectAfterDisconnect(params)) {
    return 'DISCONNECTED';
  }
  return 'FAILED';
}
