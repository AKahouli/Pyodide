import { randomBytes } from 'node:crypto';

// Mongoose accepted either hex case; ids are stored lowercase in char(24).
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const CANONICAL_OBJECT_ID = /^[0-9a-f]{24}$/;

export function isObjectId(value: string): boolean {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/** Strict: lowercase only. For domains that reject non-canonical ids (Conversation v1). */
export function isCanonicalObjectId(value: string): boolean {
  return typeof value === 'string' && CANONICAL_OBJECT_ID.test(value);
}

/** Canonical (lowercase) form used for storage and lookups. */
export function normalizeObjectId(id: string): string {
  return id.toLowerCase();
}

export function newObjectId(): string {
  return randomBytes(12).toString('hex');
}
