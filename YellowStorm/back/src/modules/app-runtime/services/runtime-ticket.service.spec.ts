import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AppRuntimeTicket } from '../schemas/app-runtime-ticket.schema';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeTicketService } from './runtime-ticket.service';
import { RuntimeTokenService } from './runtime-token.service';

describe('RuntimeTicketService', () => {
  let svc: RuntimeTicketService;

  const create = jest.fn();
  const findOneAndUpdate = jest.fn();
  const ensureForSession = jest.fn();

  const resolvesTo = (doc: unknown) => ({
    lean: () => ({ exec: () => Promise.resolve(doc) }),
  });

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
          provide: getModelToken(AppRuntimeTicket.name),
          useValue: { create, findOneAndUpdate },
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

      const [doc] = create.mock.calls[0];
      expect(doc.ticketHash).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.consumedAt).toBeNull();
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
      findOneAndUpdate.mockReturnValueOnce(
        resolvesTo({
          runtimeSessionId: 'rts_0011223344556677',
          bindingId: 'arb_aabbccddeeff',
          workspaceId: 'sess_1',
          userId: 'user_1',
        }),
      );

      const consumed = await svc.consume('a-ticket');

      expect(consumed).toEqual({
        runtimeSessionId: 'rts_0011223344556677',
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        userId: 'user_1',
      });
    });

    it('matches on hash, unconsumed and unexpired in a single atomic update', async () => {
      findOneAndUpdate.mockReturnValueOnce(resolvesTo(null));

      await svc.consume('a-ticket');

      const [filter, update] = findOneAndUpdate.mock.calls[0];
      expect(filter.ticketHash).toMatch(/^[0-9a-f]{64}$/);
      expect(filter.ticketHash).not.toBe('a-ticket');
      expect(filter.consumedAt).toBeNull();
      expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
      expect(update.$set.consumedAt).toBeInstanceOf(Date);
    });

    it('rejects a ticket that no longer matches the filter', async () => {
      findOneAndUpdate.mockReturnValueOnce(resolvesTo(null));
      await expect(svc.consume('replayed')).resolves.toBeNull();
    });

    it('rejects an empty ticket without touching Mongo', async () => {
      await expect(svc.consume('')).resolves.toBeNull();
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
