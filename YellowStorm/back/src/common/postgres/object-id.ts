import { randomBytes } from 'node:crypto';

const OBJECT_ID = /^[0-9a-f]{24}$/;

export function isObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export function newObjectId(): string {
  return randomBytes(12).toString('hex');
}
