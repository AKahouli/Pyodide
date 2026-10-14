import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex digest of a value — the at-rest hash form for one-time tokens. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Issues a fresh single-use token together with its at-rest SHA-256 hash. */
export function issueInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256Hex(token) };
}

/** SHA-256 of a trimmed token, or null for an empty / missing token. */
export function hashInvitationToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim();
  return trimmed ? sha256Hex(trimmed) : null;
}
