import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';
import { IdempotencyRepository, type IdempotencyRecord } from '../persistence/idempotency.repository';

describe('PlaybookFlowIdempotencyService', () => {
  let service: PlaybookFlowIdempotencyService;
  let repository: Record<keyof IdempotencyRepository, jest.Mock>;

  const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const KEY = 'idem-key-1';

  const hashPayload = (body: unknown): string => {
    const sortKeys = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(sortKeys);
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      const result: Record<string, unknown> = {};
      for (const [k, val] of entries) result[k] = sortKeys(val);
      return result;
    };
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(sortKeys(body))).digest('hex');
  };

  let stored: IdempotencyRecord[] = [];

  const record = (over: Partial<IdempotencyRecord>): IdempotencyRecord => ({
    id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    ownerId: OWNER,
    idempotencyKey: KEY,
    payloadHash: 'abc123',
    executionId: null,
    responseBody: null,
    expectedStateHash: null,
    expectedDefinitionRevision: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
  const find = (ownerId: string, key: string) => stored.find((r) => r.ownerId === ownerId && r.idempotencyKey === key);
  const live = (r: IdempotencyRecord | undefined) => (r && r.expiresAt.getTime() > Date.now() ? r : undefined);

  beforeEach(async () => {
    stored = [];

    // Mirrors the table: unique (owner, key); an expired record is invisible and a reservation takes it over.
    repository = {
      reserve: jest.fn(async (input: { ownerId: string; idempotencyKey: string; payloadHash: string; expiresAt: Date }) => {
        const existing = find(input.ownerId, input.idempotencyKey);
        if (live(existing)) return false;
        stored = stored.filter((r) => r !== existing);
        stored.push(record({ ownerId: input.ownerId, idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash, expiresAt: input.expiresAt }));
        return true;
      }),
      findLive: jest.fn(async (ownerId: string, key: string) => live(find(ownerId, key)) ?? null),
      update: jest.fn(async (ownerId: string, key: string, patch: Partial<IdempotencyRecord>) => {
        const existing = live(find(ownerId, key));
        if (existing) Object.assign(existing, patch);
        return Boolean(existing);
      }),
      delete: jest.fn(async (ownerId: string, key: string) => {
        const existing = find(ownerId, key);
        stored = stored.filter((r) => r !== existing);
        return Boolean(existing);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowIdempotencyService,
        { provide: IdempotencyRepository, useValue: repository },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(24) } },
      ],
    }).compile();

    service = module.get<PlaybookFlowIdempotencyService>(PlaybookFlowIdempotencyService);
  });

  describe('reserve', () => {
    it('returns reserved when no record exists, with the payload hash and a TTL expiry', async () => {
      const before = Date.now();
      const result = await service.reserve(OWNER, KEY, { flowId: 'f1' });
      expect(result).toEqual({ type: 'reserved' });
      expect(stored.length).toBe(1);
      expect(stored[0].executionId).toBeNull();
      expect(stored[0].payloadHash).toBe(hashPayload({ flowId: 'f1' }));
      expect(stored[0].expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    });

    it('returns duplicate with executionId when same payload exists', async () => {
      const payload = { flowId: 'f1' };
      stored.push(record({ payloadHash: hashPayload(payload), executionId: 'exec-1' }));

      const result = await service.reserve(OWNER, KEY, payload);
      expect(result).toEqual({ type: 'duplicate', executionId: 'exec-1' });
    });

    it('hashes payloads independently of key order', async () => {
      stored.push(record({ payloadHash: hashPayload({ a: 1, b: { c: 2, d: 3 } }), executionId: 'exec-1' }));

      await expect(service.reserve(OWNER, KEY, { b: { d: 3, c: 2 }, a: 1 })).resolves.toEqual({ type: 'duplicate', executionId: 'exec-1' });
    });

    it('throws ConflictException when same key used with different payload', async () => {
      stored.push(record({ payloadHash: hashPayload({ flowId: 'f1' }), executionId: 'exec-1' }));

      await expect(service.reserve(OWNER, KEY, { flowId: 'f1', extra: 'unexpected' })).rejects.toThrow('different input');
    });

    it('throws ConflictException when reservation exists without executionId (previous failure)', async () => {
      const payload = { flowId: 'f1' };
      stored.push(record({ payloadHash: hashPayload(payload) }));

      await expect(service.reserve(OWNER, KEY, payload)).rejects.toThrow('execution was not created');
    });

    it('treats an expired record as absent and reserves the key afresh', async () => {
      stored.push(record({ payloadHash: hashPayload({ flowId: 'old' }), executionId: 'exec-old', expiresAt: new Date(Date.now() - 1_000) }));

      await expect(service.reserve(OWNER, KEY, { flowId: 'f1' })).resolves.toEqual({ type: 'reserved' });
      expect(stored).toEqual([expect.objectContaining({ payloadHash: hashPayload({ flowId: 'f1' }), executionId: null })]);
    });

    it('retries as a reservation when the conflicting record disappears before it is read', async () => {
      repository.reserve.mockResolvedValueOnce(false);

      await expect(service.reserve(OWNER, KEY, { flowId: 'f1' })).resolves.toEqual({ type: 'reserved' });
      expect(repository.reserve).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirmLink', () => {
    it('updates executionId on existing record', async () => {
      stored.push(record({}));

      await service.confirmLink(OWNER, KEY, 'exec-99');
      expect(stored[0].executionId).toBe('exec-99');
    });
  });

  describe('reserveSave / confirmSaveResult', () => {
    it('returns duplicate with stored response body for matching payload', async () => {
      const payload = { flowId: 'f1', name: 'Saved' };
      stored.push(record({ payloadHash: hashPayload(payload), responseBody: { id: 'flow-1', definitionRevision: 2 } }));

      const result = await service.reserveSave(OWNER, KEY, payload);
      expect(result).toEqual({ type: 'duplicate', responseBody: { id: 'flow-1', definitionRevision: 2 } });
    });

    it('returns duplicate-pending when a matching save reservation has no response body yet', async () => {
      const payload = { flowId: 'f1', name: 'Saved' };
      stored.push(record({ payloadHash: hashPayload(payload) }));

      const result = await service.reserveSave(OWNER, KEY, payload);
      expect(result).toStrictEqual({ type: 'duplicate-pending', expectedStateHash: undefined, expectedDefinitionRevision: undefined });
    });

    it('returns the recorded expected save state with a pending duplicate', async () => {
      const payload = { flowId: 'f1', name: 'Saved' };
      stored.push(record({ payloadHash: hashPayload(payload) }));

      await service.recordExpectedSaveState(OWNER, KEY, 'state-hash', 3);

      await expect(service.reserveSave(OWNER, KEY, payload)).resolves.toEqual({
        type: 'duplicate-pending', expectedStateHash: 'state-hash', expectedDefinitionRevision: 3,
      });
    });

    it('throws ConflictException when a save key is reused with a different payload', async () => {
      stored.push(record({ payloadHash: hashPayload({ flowId: 'f1' }) }));

      await expect(service.reserveSave(OWNER, KEY, { flowId: 'f2' })).rejects.toThrow('different input');
    });

    it('stores response body when confirming a save result', async () => {
      stored.push(record({}));

      await service.confirmSaveResult(OWNER, KEY, { id: 'flow-1', applied: true });
      expect(stored[0].responseBody).toEqual({ id: 'flow-1', applied: true });
    });
  });

  describe('release', () => {
    it('removes the record', async () => {
      stored.push(record({}));

      await service.release(OWNER, KEY);
      expect(stored.length).toBe(0);
    });
  });
});
