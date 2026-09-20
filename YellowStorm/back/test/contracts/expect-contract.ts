/**
 * Step 0.2 — contract fixture helper.
 *
 * Fixtures are wire-format JSON recorded from the current Mongo build (HTTP
 * responses, or schema `.toJSON()` output for serializer contracts). The
 * comparison is deep over KEYS and VALUE TYPES only — volatile values need no
 * exact match, which is what makes the same fixture gate both today's Mongo
 * serializers and tomorrow's PostgreSQL mappers (steps 1A/1B/P3/P4).
 *
 * Re-record: UPDATE_FIXTURES=1 npm run test:contracts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import mongoose from 'mongoose';

const CONTRACTS_DIR = __dirname;

/**
 * Build a hydrated Mongoose document from a POJO without touching the
 * database, so serializer fixtures exercise the real schema toJSON transform.
 */
export function hydrateDoc(schema: mongoose.Schema, doc: Record<string, unknown>): { toJSON(): unknown } {
  const model = mongoose.model('ContractFixture', schema);
  return model.hydrate(doc) as unknown as { toJSON(): unknown };
}

/** Keys whose stored value is cosmetic; replaced by `<volatile>` in fixtures. */
const VOLATILE_KEYS = new Set([
  'createdAt', 'updatedAt', 'timestamp', 'requestId', 'expiresAt', 'recordedAt',
  'lastActivityAt', 'lastUsedAt', 'lastWebhookAt', 'lastRefreshedAt', 'lastLoginAt',
  'lastMessageAt', 'linkedAt', 'planStartedAt', 'sentAt', 'readAt', 'disconnectedAt',
  'rotatedAt', 'consumedAt', 'privacyPolicyAcceptedAt', 'dataSharingAcceptedAt',
  'emailVerificationExpiry', 'passwordResetExpiry',
]);

function isObjectId(value: object): boolean {
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  return ctor === 'ObjectId' || ctor === 'Types.ObjectId';
}

/**
 * Structural shape of a wire payload: objects map key → shape, arrays map to
 * `[shapeOf(firstElement)]`, and everything Date/ObjectId-ish collapses to
 * 'string' (the wire format), scalars to their typeof, null to 'null'.
 */
export function shapeOf(value: unknown): unknown {
  if (value === null) return 'null';
  if (value instanceof Date || isObjectId(value as object)) return 'string';
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, shapeOf(v)]),
    );
  }
  return typeof value;
}

function maskVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskVolatile);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        VOLATILE_KEYS.has(k) ? '<volatile>' : maskVolatile(v),
      ]),
    );
  }
  return value;
}

export function fixturePath(name: string): string {
  return path.join(CONTRACTS_DIR, `${name}.fixture.json`);
}

export function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8'));
}

export function writeFixture(name: string, wire: unknown): void {
  fs.writeFileSync(fixturePath(name), `${JSON.stringify(maskVolatile(wire), null, 2)}\n`);
}

export function updateFixtures(): boolean {
  return process.env.UPDATE_FIXTURES === '1';
}

/** Assert `actual` has the same keys and value types as the stored fixture. */
export function expectContract(name: string, actual: unknown): void {
  if (updateFixtures()) {
    writeFixture(name, actual);
    return;
  }
  expect(shapeOf(actual)).toEqual(shapeOf(loadFixture(name)));
}
