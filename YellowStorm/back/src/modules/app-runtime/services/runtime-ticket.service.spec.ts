import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RUNTIME_TICKET_STORE, type RuntimeTicketStore } from '../persistence/runtime-ticket.store';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeTicketService } from './runtime-ticket.service';
import { RuntimeTokenService } from './runtime-token.service';

describe('RuntimeTicketService', () => {
  let svc: RuntimeTicketService;

  const create = jest.fn();
  const consumeByHash = jest.fn();
  const ensureForSession = jest.fn();

  const store: RuntimeTicketStore = {
    create,
    consumeByHash,
  };

  const config = {
    get: jest.fn((key: string, fallback?: number) =>
      key === 'appRuntime.ticketTtlMs' ? 60_000 : fallback,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeTicketService,
        RuntimeTokenService,
        {
          provide: RUNTIME_TICKET_STORE,
          useValue: store,
        },
        { provide: RuntimeBindingService, useValue: { ensureForSession } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    svc = module.get(RuntimeTicketService);
  });

  describe('issue', () => {
    beforeEach(() => {
      ensureForSession.mockResolvedValue({
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        latestRevisionId: 'rev_3',
      });
      create.mockImplementation((data) =>
        Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }),
      );
    });

    it('returns the workspace and revision without ever exposing the MCP token', async () => {
      const result = await svc.issue({
        conversationSessionId: 'sess_1',
        userId: 'user_1',
      });

      expect(ensureForSession).toHaveBeenCalledWith('sess_1', 'user_1');
      expect(result.workspaceId).toBe('sess_1');
      expect(result.revisionId).toBe('rev_3');
      expect(result.runtimeSessionId).toMatch(/^rts_[0-9a-f]{16}$/);
      expect(result.ticket).not.toHaveLength(0);
      expect(Object.keys(result).sort()).toEqual([
        'expiresAt',
        'revisionId',
        'runtimeSessionId',
        'ticket',
        'workspaceId',
      ]);
    });

    it('persists only the ticket hash, never the plaintext', async () => {
      const result = await svc.issue({
        conversationSessionId: 'sess_1',
        userId: 'user_1',
      });

      const doc = create.mock.calls[0][0];
      expect(doc.ticketHash).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.consumedAt).toBeUndefined();
      expect(JSON.stringify(doc)).not.toContain(result.ticket);
    });

    it('expires the ticket after the configured TTL', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const result = await svc.issue({
        conversationSessionId: 'sess_1',
        userId: 'user_1',
      });

      expect(result.expiresAt).toBe('2026-01-01T00:01:00.000Z');
      jest.useRealTimers();
    });
  });

  describe('consume', () => {
    it('redeems a live ticket and returns its binding', async () => {
      consumeByHash.mockResolvedValueOnce({
        runtimeSessionId: 'rts_0011223344556677',
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        userId: 'user_1',
      });

      const consumed = await svc.consume('a-ticket');

      expect(consumed).toEqual({
        runtimeSessionId: 'rts_0011223344556677',
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        userId: 'user_1',
      });
    });

    it('calls the store with the hashed ticket', async () => {
      consumeByHash.mockResolvedValueOnce(null);

      await svc.consume('a-ticket');

      const hash = consumeByHash.mock.calls[0][0];
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toBe('a-ticket');
    });

    it('rejects a ticket that no longer matches the filter', async () => {
      consumeByHash.mockResolvedValueOnce(null);
      await expect(svc.consume('replayed')).resolves.toBeNull();
    });

    it('rejects an empty ticket without touching the store', async () => {
      await expect(svc.consume('')).resolves.toBeNull();
      expect(consumeByHash).not.toHaveBeenCalled();
    });
  });
});
