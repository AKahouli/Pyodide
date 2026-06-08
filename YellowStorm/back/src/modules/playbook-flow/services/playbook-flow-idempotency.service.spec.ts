import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';

describe('PlaybookFlowIdempotencyService', () => {
  let service: PlaybookFlowIdempotencyService;
  let model: any;

  const OWNER = 'user-1';
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

  type StoredRecord = {
    ownerId: string;
    idempotencyKey: string;
    payloadHash: string;
    executionId?: string;
    responseBody?: Record<string, unknown>;
  };

  let stored: StoredRecord[] = [];

  beforeEach(async () => {
    stored = [];

    const mockModel = {
      findOne: jest.fn().mockImplementation((filter: Record<string, string>) => {
        const match = stored.find(
          (r) => r.ownerId === filter.ownerId && r.idempotencyKey === filter.idempotencyKey,
        );
        return {
          lean: () => Promise.resolve(match || null),
        };
      }),
      create: jest.fn().mockImplementation((doc: StoredRecord & { expiresAt: Date }) => {
        const existing = stored.find(
          (r) => r.ownerId === doc.ownerId && r.idempotencyKey === doc.idempotencyKey,
        );
        if (existing) {
          const err: any = new Error('Duplicate key');
          err.code = 11000;
          throw err;
        }
        const record: StoredRecord = {
          ownerId: doc.ownerId,
          idempotencyKey: doc.idempotencyKey,
          payloadHash: doc.payloadHash,
          executionId: doc.executionId,
          responseBody: doc.responseBody,
        };
        stored.push(record);
        return record;
      }),
      updateOne: jest.fn().mockImplementation(
        (filter: Record<string, string>, update: Record<string, unknown>) => {
          const record = stored.find(
            (r) => r.ownerId === filter.ownerId && r.idempotencyKey === filter.idempotencyKey,
          );
          if (record && update.$set) {
            Object.assign(record, update.$set);
          }
          return { exec: () => Promise.resolve() };
        },
      ),
      deleteOne: jest.fn().mockImplementation((filter: Record<string, string>) => {
        const idx = stored.findIndex(
          (r) => r.ownerId === filter.ownerId && r.idempotencyKey === filter.idempotencyKey,
        );
        if (idx >= 0) stored.splice(idx, 1);
        return { exec: () => Promise.resolve() };
      }),
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue(24),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowIdempotencyService,
        { provide: getModelToken('FlowIdempotencyRecord'), useValue: mockModel },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PlaybookFlowIdempotencyService>(PlaybookFlowIdempotencyService);
    model = mockModel;
  });

  describe('reserve', () => {
    it('returns reserved when no record exists', async () => {
      const result = await service.reserve(OWNER, KEY, { flowId: 'f1' });
      expect(result).toEqual({ type: 'reserved' });
      expect(stored.length).toBe(1);
      expect(stored[0].executionId).toBeUndefined();
    });

    it('returns duplicate with executionId when same payload exists', async () => {
      const payload = { flowId: 'f1' };
      const hash = hashPayload(payload);
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: hash, executionId: 'exec-1' });

      const result = await service.reserve(OWNER, KEY, payload);
      expect(result).toEqual({ type: 'duplicate', executionId: 'exec-1' });
    });

    it('throws ConflictException when same key used with different payload', async () => {
      const originalHash = hashPayload({ flowId: 'f1' });
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: originalHash, executionId: 'exec-1' });

      await expect(service.reserve(OWNER, KEY, { flowId: 'f1', extra: 'unexpected' })).rejects.toThrow();
    });

    it('throws ConflictException when reservation exists without executionId (previous failure)', async () => {
      const payload = { flowId: 'f1' };
      const hash = hashPayload(payload);
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: hash });

      await expect(service.reserve(OWNER, KEY, payload)).rejects.toThrow();
    });
  });

  describe('confirmLink', () => {
    it('updates executionId on existing record', async () => {
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: 'abc123' });

      await service.confirmLink(OWNER, KEY, 'exec-99');
      expect(stored[0].executionId).toBe('exec-99');
    });
  });

  describe('reserveSave / confirmSaveResult', () => {
    it('returns duplicate with stored response body for matching payload', async () => {
      const payload = { flowId: 'f1', name: 'Saved' };
      const hash = hashPayload(payload);
      stored.push({
        ownerId: OWNER,
        idempotencyKey: KEY,
        payloadHash: hash,
        responseBody: { id: 'flow-1', definitionRevision: 2 },
      });

      const result = await service.reserveSave(OWNER, KEY, payload);
      expect(result).toEqual({ type: 'duplicate', responseBody: { id: 'flow-1', definitionRevision: 2 } });
    });

    it('returns duplicate-pending when a matching save reservation has no response body yet', async () => {
      const payload = { flowId: 'f1', name: 'Saved' };
      const hash = hashPayload(payload);
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: hash });

      const result = await service.reserveSave(OWNER, KEY, payload);
      expect(result).toEqual({ type: 'duplicate-pending' });
    });

    it('stores response body when confirming a save result', async () => {
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: 'abc123' });

      await service.confirmSaveResult(OWNER, KEY, { id: 'flow-1', applied: true });
      expect(stored[0].responseBody).toEqual({ id: 'flow-1', applied: true });
    });
  });

  describe('release', () => {
    it('removes the record', async () => {
      stored.push({ ownerId: OWNER, idempotencyKey: KEY, payloadHash: 'abc123' });

      await service.release(OWNER, KEY);
      expect(stored.length).toBe(0);
    });
  });
});
