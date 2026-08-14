import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AppRuntimeBinding } from '../schemas/app-runtime-binding.schema';
import { RuntimeBindingService } from './runtime-binding.service';
import { RuntimeRevisionService } from './runtime-revision.service';
import { RuntimeTokenService } from './runtime-token.service';

const MCP_URL = 'http://127.0.0.1:3000/api/v1/mcp/app-runtime';
const STARTER = 'starter_react_vite_v1';

describe('RuntimeBindingService', () => {
  let svc: RuntimeBindingService;

  const findOneAndUpdate = jest.fn();
  const updateOne = jest.fn();
  const ensureStarterRevision = jest.fn().mockResolvedValue({
    revisionId: STARTER,
  });

  const resolvesTo = (doc: unknown) => ({
    lean: () => ({ exec: () => Promise.resolve(doc) }),
  });

  const rejectsWith = (error: unknown) => ({
    lean: () => ({ exec: () => Promise.reject(error) }),
  });

  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'appRuntime.mcpUrl') return MCP_URL;
      if (key === 'appRuntime.starterRevisionId') return STARTER;
      return fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ensureStarterRevision.mockResolvedValue({ revisionId: STARTER });
    updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeBindingService,
        RuntimeTokenService,
        {
          provide: getModelToken(AppRuntimeBinding.name),
          useValue: { findOneAndUpdate, updateOne },
        },
        { provide: RuntimeRevisionService, useValue: { ensureStarterRevision } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    svc = module.get(RuntimeBindingService);
  });

  it('creates a binding with a generated id, the starter revision and the configured MCP URL', async () => {
    findOneAndUpdate.mockReturnValueOnce(
      resolvesTo({
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        latestRevisionId: STARTER,
      }),
    );

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
    expect(ensureStarterRevision).toHaveBeenCalledWith('sess_1');

    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ workspaceId: 'sess_1' });
    expect(update.$setOnInsert.bindingId).toMatch(/^arb_[0-9a-f]{12}$/);
    expect(update.$setOnInsert.status).toBe('created');
    expect(update.$setOnInsert.latestRevisionId).toBe(STARTER);
    expect(update.$set.userId).toBe('user_1');
    expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
  });

  it('persists only the token hash, never the plaintext', async () => {
    findOneAndUpdate.mockReturnValueOnce(
      resolvesTo({
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        latestRevisionId: STARTER,
      }),
    );

    const result = await svc.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    const [, update] = findOneAndUpdate.mock.calls[0];
    expect(update.$set.mcpTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(update)).not.toContain(result.mcpToken);
  });

  it('reuses the binding id and revision on re-bind but rotates the token', async () => {
    const existing = {
      bindingId: 'arb_existing0001',
      workspaceId: 'sess_1',
      latestRevisionId: 'rev_7',
    };
    findOneAndUpdate
      .mockReturnValueOnce(resolvesTo(existing))
      .mockReturnValueOnce(resolvesTo(existing));

    const first = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });
    const second = await svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' });

    expect(second.bindingId).toBe(first.bindingId);
    expect(second.latestRevisionId).toBe('rev_7');
    expect(second.mcpToken).not.toBe(first.mcpToken);

    const firstHash = findOneAndUpdate.mock.calls[0][1].$set.mcpTokenHash;
    const secondHash = findOneAndUpdate.mock.calls[1][1].$set.mcpTokenHash;
    expect(secondHash).not.toBe(firstHash);
  });

  it('retries once when a concurrent bind wins the insert race', async () => {
    findOneAndUpdate
      .mockReturnValueOnce(rejectsWith({ code: 11000 }))
      .mockReturnValueOnce(
        resolvesTo({
          bindingId: 'arb_concurrent1',
          workspaceId: 'sess_1',
          latestRevisionId: STARTER,
        }),
      );

    const result = await svc.bind({
      conversationSessionId: 'sess_1',
      userId: 'user_1',
    });

    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(result.bindingId).toBe('arb_concurrent1');
  });

  it('ensureForSession creates a binding without rotating the live MCP token', async () => {
    findOneAndUpdate.mockReturnValueOnce(
      resolvesTo({
        bindingId: 'arb_aabbccddeeff',
        workspaceId: 'sess_1',
        latestRevisionId: 'rev_5',
      }),
    );

    const binding = await svc.ensureForSession('sess_1', 'user_1');

    expect(binding.latestRevisionId).toBe('rev_5');
    expect(ensureStarterRevision).toHaveBeenCalledWith('sess_1');

    const [, update] = findOneAndUpdate.mock.calls[0];
    expect(update.$set.mcpTokenHash).toBeUndefined();
    // Placeholder hash matches no token, so the binding stays unusable over MCP
    // until APImanus actually binds it.
    expect(update.$setOnInsert.mcpTokenHash).toBe('');
  });

  it('propagates non-duplicate persistence errors', async () => {
    findOneAndUpdate.mockReturnValueOnce(rejectsWith(new Error('mongo down')));

    await expect(
      svc.bind({ conversationSessionId: 'sess_1', userId: 'user_1' }),
    ).rejects.toThrow('mongo down');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('markWaitingForBrowser only transitions from browser_active', async () => {
    await svc.markWaitingForBrowser('sess_1');

    expect(updateOne).toHaveBeenCalledWith(
      { workspaceId: 'sess_1', status: 'browser_active' },
      { $set: { status: 'waiting_for_browser' } },
    );
  });
});
