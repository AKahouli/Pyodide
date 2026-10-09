/**
 * In-memory holder for the short-lived access token.
 *
 * The token never touches localStorage/sessionStorage (readable by any
 * injected script); session continuity across reloads comes from the
 * HttpOnly refresh cookie via `restoreSessionFromCookie()` in client.ts.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
