import { randomBytes } from 'node:crypto';

const OWNED_ID = /^[0-9a-f]{24}$/;

export function isOwnedId(value: string): boolean {
  return OWNED_ID.test(value);
}

export function newOwnedId(): string {
  return randomBytes(12).toString('hex');
}
