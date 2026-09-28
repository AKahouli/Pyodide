import { AiPreviewTicketService } from './ai-preview-ticket.service';
import { RuntimeBindingService } from '../../app-runtime/services/runtime-binding.service';
import { RuntimeTokenService } from '../../app-runtime/services/runtime-token.service';
import { type AiPreviewTicketStore } from '../persistence/ai-preview-ticket.store';

describe('AiPreviewTicketService', () => {
  const create = jest.fn();
  const expireLiveForWorkspace = jest.fn();
  const findLiveByHash = jest.fn();

  const store: AiPreviewTicketStore = {
    create,
    expireLiveForWorkspace,
    findLiveByHash,
  };

  const bindings = {
    ensureForSession: jest.fn().mockResolvedValue({
      bindingId: 'arb_test',
      workspaceId: 'ws_1',
    }),
  } as unknown as RuntimeBindingService;

  const tokens = new RuntimeTokenService();
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  };

  const createService = () =>
    new AiPreviewTicketService(
      store as never,
      bindings,
      tokens,
      config as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockImplementation((data) =>
      Promise.resolve({ id: 'generated_id', ...data, createdAt: new Date(), updatedAt: new Date() }),
    );
    expireLiveForWorkspace.mockResolvedValue(undefined);
    findLiveByHash.mockResolvedValue(null);
  });

  it('issues an aiprev_ ticket and persists only the hash', async () => {
    const svc = createService();
    const result = await svc.issue({
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
    });

    expect(result.ticket.startsWith('aiprev_')).toBe(true);
    expect(result.workspaceId).toBe('ws_1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketHash: tokens.hash(result.ticket),
        billableUserId: 'owner-1',
        purpose: 'ai_preview',
        bindingId: 'arb_test',
      }),
    );
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain(result.ticket);
  });

  it('verifies a live ticket and rejects expired/unknown', async () => {
    const svc = createService();
    const issued = await svc.issue({
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
    });

    findLiveByHash.mockResolvedValueOnce({
      id: 'gen_id',
      workspaceId: 'ws_1',
      bindingId: 'arb_test',
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
      ticketHash: tokens.hash(issued.ticket),
      purpose: 'ai_preview',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ok = await svc.verify(issued.ticket);
    expect(ok?.billableUserId).toBe('owner-1');

    findLiveByHash.mockResolvedValueOnce(null);
    expect(await svc.verify(issued.ticket)).toBeNull();
    expect(await svc.verify('not-a-ticket')).toBeNull();
  });
});
