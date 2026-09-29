import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PgConversationV2SessionStore } from '@modules/conversation-v2/persistence/postgres/pg-conversation-v2-session.store';
import { type RuntimeBindingStore } from '../persistence/runtime-binding.store';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeRevisionService } from './runtime-revision.service';
import { RuntimeTokenService } from './runtime-token.service';
import { PgRuntimeBindingStore } from '../persistence/pg-runtime-binding.store';
import { PlatformBaselineService } from '../platform-kit/platform-baseline.service';

const MCP_URL = 'http://127.0.0.1:3000/api/v1/mcp/app-runtime';
const STARTER = 'starter_react_vite_v1';

describe('RuntimeBindingService', () => {
  let svc: RuntimeBindingService;

  const upsertByWorkspaceId = jest.fn();
  const findByWorkspaceId = jest.fn();
  const findByMcpTokenHash = jest.fn();
  const updateStatus = jest.fn().mockResolvedValue(undefined);
  const updateHeartbeat = jest.fn().mockResolvedValue(undefined);
  const updateRevision = jest.fn().mockResolvedValue(undefined);

  const ensureWorkspaceRevision = jest.fn().mockResolvedValue({
    revisionId: STARTER,
  });
  const revisionExists = jest.fn().mockResolvedValue(true);

  const findByAiSessionId = jest.fn();
  const applyBaseline = jest.fn();

  const store: RuntimeBindingStore = {
    upsertByWorkspaceId,
    findByWorkspaceId,
    findByMcpTokenHash,
    updateStatus,
    updateHeartbeat,
    updateRevision,
  };

  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'appRuntime.mcpUrl') return MCP_URL;
      if (key === 'appRuntime.starterRevisionId') return STARTER;
      return fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ensureWorkspaceRevision.mockResolvedValue({ revisionId: STARTER });
    findByAiSessionId.mockResolvedValue(null);
    applyBaseline.mockResolvedValue({
      revisionId: 'rev_1',
      plan: { files: [], violations: [], warnings: [] },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeBindingService,
        RuntimeTokenService,
        {
          provide: PgRuntimeBindingStore,
          useValue: store,
        },
        {
          provide: RuntimeRevisionService,
          useValue: { ensureWorkspaceRevision, revisionExists },
        },
        { provide: PlatformBaselineService, useValue: { applyBaseline } },
        { provide: ConfigService, useValue: config },
        { provide: PgConversationV2SessionStore, useValue: { findByAiSessionId } },
      ],
    }).compile();

    svc = module.get(RuntimeBindingService);
  });

  it('creates a binding with a generated id, the starter revision and the configured MCP URL', async () => {
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: STARTER,
      mcpTokenHash: 'hash',
    });

    const result = await svc.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    expect(result).toEqual({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: STARTER,
      mcpUrl: MCP_URL,
      mcpToken: expect.any(String),
    });
    expect(result.mcpToken).not.toHaveLength(0);
    expect(ensureWorkspaceRevision).toHaveBeenCalledWith('sess_1', STARTER);

    const call = upsertByWorkspaceId.mock.calls[0][0];
    expect(call.workspaceId).toBe('sess_1');
    expect(call.bindingId).toMatch(/^arb_[0-9a-f]{12}$/);
    expect(call.status).toBe('created');
    expect(call.latestRevisionId).toBe(STARTER);
    expect(call.userId).toBe('user_1');
  });

  it('persists only the token hash, never the plaintext', async () => {
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: STARTER,
    });

    const result = await svc.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    const call = upsertByWorkspaceId.mock.calls[0][0];
    expect(call.mcpTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call)).not.toContain(result.mcpToken);
  });

  it('reuses the binding id and revision on re-bind but rotates the token', async () => {
    const existing = {
      bindingId: 'arb_existing0001',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_7',
    };
    upsertByWorkspaceId
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    const first = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });
    const second = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(second.bindingId).toBe(first.bindingId);
    expect(second.latestRevisionId).toBe('rev_7');
    expect(second.mcpToken).not.toBe(first.mcpToken);

    const firstHash = upsertByWorkspaceId.mock.calls[0][0].mcpTokenHash;
    const secondHash = upsertByWorkspaceId.mock.calls[1][0].mcpTokenHash;
    expect(secondHash).not.toBe(firstHash);
  });

  it('retries once when a concurrent bind wins the insert race', async () => {
    upsertByWorkspaceId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        bindingId: 'arb_concurrent1',
        workspaceId: 'sess_1',
        latestRevisionId: STARTER,
      });

    const result = await svc.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    expect(upsertByWorkspaceId).toHaveBeenCalledTimes(2);
    expect(result.bindingId).toBe('arb_concurrent1');
  });

  it('ensureForSession creates a binding without rotating the live MCP token', async () => {
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_5',
    });

    const binding = await svc.ensureForSession('sess_1', 'user_1');

    expect(binding.latestRevisionId).toBe('rev_5');
    expect(ensureWorkspaceRevision).toHaveBeenCalledWith('sess_1', 'rev_5');

    const call = upsertByWorkspaceId.mock.calls[0][0];
    expect(call.mcpTokenHash).toBeNull();
  });

  it('seeds the binding revision from the session template revision', async () => {
    findByAiSessionId.mockResolvedValueOnce({ starterRevisionId: 'template_tpl_1' });
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: 'template_tpl_1',
    });

    const result = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(findByAiSessionId).toHaveBeenCalledWith('sess_1');
    const call = upsertByWorkspaceId.mock.calls[0][0];
    expect(call.latestRevisionId).toBe('template_tpl_1');
    expect(ensureWorkspaceRevision).toHaveBeenCalledWith('sess_1', 'template_tpl_1');

    // The browser must boot on the template normalized with the Platform Kit.
    expect(applyBaseline).toHaveBeenCalledWith({
      workspaceId: 'sess_1',
      baseRevisionId: 'template_tpl_1',
      newRevisionId: 'rev_1',
      mode: 'seed',
    });
    expect(updateRevision).toHaveBeenCalledWith('sess_1', 'rev_1');
    expect(result.latestRevisionId).toBe('rev_1');
  });

  it('promotes a stale system-starter binding to the session template seed', async () => {
    findByAiSessionId.mockResolvedValueOnce({ starterRevisionId: 'template_tpl_1' });
    // Conflict upsert keeps the previous starter revision (by design).
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: STARTER,
    });

    const result = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(updateRevision).toHaveBeenCalledWith('sess_1', 'template_tpl_1');
    expect(ensureWorkspaceRevision).toHaveBeenCalledWith('sess_1', 'template_tpl_1');
    expect(applyBaseline).toHaveBeenCalledWith({
      workspaceId: 'sess_1',
      baseRevisionId: 'template_tpl_1',
      newRevisionId: 'rev_1',
      mode: 'seed',
    });
    expect(result.latestRevisionId).toBe('rev_1');
  });

  it('does not promote when the agent already owns a workspace revision', async () => {
    findByAiSessionId.mockResolvedValueOnce({ starterRevisionId: 'template_tpl_1' });
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_4',
    });

    await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(updateRevision).not.toHaveBeenCalledWith('sess_1', 'template_tpl_1');
    expect(applyBaseline).not.toHaveBeenCalled();
  });

  it('does not normalize a workspace revision the agent already owns', async () => {
    upsertByWorkspaceId.mockResolvedValueOnce({
      bindingId: 'arb_aabbccddeeff',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_4',
    });

    await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(applyBaseline).not.toHaveBeenCalled();
  });

  it('propagates non-duplicate persistence errors', async () => {
    upsertByWorkspaceId.mockRejectedValueOnce(new Error('pg down'));

    await expect(
      svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' }),
    ).rejects.toThrow('pg down');
    expect(upsertByWorkspaceId).toHaveBeenCalledTimes(1);
  });

  it('markWaitingForBrowser only transitions from browser_active', async () => {
    await svc.markWaitingForBrowser('sess_1');

    expect(updateStatus).toHaveBeenCalledWith(
      'sess_1',
      'browser_active',
      'waiting_for_browser',
    );
  });
});
