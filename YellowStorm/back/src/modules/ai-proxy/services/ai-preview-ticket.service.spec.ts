import { AiPreviewTicketService } from './ai-preview-ticket.service';
import { RuntimeBindingService } from '../../app-runtime/services/runtime-binding.service';
import { RuntimeTokenService } from '../../app-runtime/services/runtime-token.service';

describe('AiPreviewTicketService', () => {
  const leanExec = jest.fn();
  const model = {
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    findOne: jest.fn(() => ({
      lean: () => ({
        exec: leanExec,
      }),
    })),
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
      model as never,
      bindings,
      tokens,
      config as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    model.create.mockResolvedValue({});
    model.updateMany.mockResolvedValue({ modifiedCount: 0 });
    leanExec.mockResolvedValue(null);
  });

  it('issues an aiprev_ ticket and persists only the hash', async () => {
    const svc = createService();
    const result = await svc.issue({
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
    });

    expect(result.ticket.startsWith('aiprev_')).toBe(true);
    expect(result.workspaceId).toBe('ws_1');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketHash: tokens.hash(result.ticket),
        billableUserId: 'owner-1',
        purpose: 'ai_preview',
        bindingId: 'arb_test',
      }),
    );
    expect(JSON.stringify(model.create.mock.calls[0][0])).not.toContain(result.ticket);
  });

  it('verifies a live ticket and rejects expired/unknown', async () => {
    const svc = createService();
    const issued = await svc.issue({
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
    });

    leanExec.mockResolvedValueOnce({
      workspaceId: 'ws_1',
      bindingId: 'arb_test',
      conversationSessionId: 'ws_1',
      billableUserId: 'owner-1',
    });

    const ok = await svc.verify(issued.ticket);
    expect(ok?.billableUserId).toBe('owner-1');

    leanExec.mockResolvedValueOnce(null);
    expect(await svc.verify(issued.ticket)).toBeNull();
    expect(await svc.verify('not-a-ticket')).toBeNull();
  });
});
