/**
 * Decide whether to reconnect a Gemini Live session after the WS closes.
 * 1008 (policy violation — bad/expired token or missing permission) is fatal
 * and must not retry; other closes (incl. normal 1000 after a goAway) reconnect
 * with the stored resumption handle until the attempt budget is exhausted.
 */
export function shouldReconnect(closeCode: number, attempt: number, maxAttempts: number): boolean {
  if (closeCode === 1008) return false;
  return attempt < maxAttempts;
}
