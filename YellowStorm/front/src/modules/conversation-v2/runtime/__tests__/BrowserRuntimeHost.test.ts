import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserRuntimeHost, getOrCreateHost, removeHost } from '../BrowserRuntimeHost';
import { ToolError } from '../ToolError';
import { RuntimeErrorCodes } from '../runtime.types';

// Mock all dependencies
vi.mock('../../api', () => ({
  conversationV2Api: {
    createRuntimeTicket: vi.fn().mockResolvedValue({
      runtimeSessionId: 'rts_abc',
      ticket: 'ticket_123',
      workspaceId: 'ws_1',
      revisionId: 'starter_react_vite_v1',
      expiresAt: '2026-12-31T23:59:59Z',
    }),
  },
}));

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockRegister = vi.fn().mockResolvedValue({ ok: true });
const mockStartHeartbeat = vi.fn();
const mockStopHeartbeat = vi.fn();
const mockDisconnect = vi.fn();
const mockOnToolInvoke = vi.fn();
const mockOnRehydrate = vi.fn();
const mockOnDisconnect = vi.fn();
const mockOnConnect = vi.fn();
const mockEmitToolCompleted = vi.fn();
const mockEmitToolFailed = vi.fn();
const mockEmitToolProgress = vi.fn();

vi.mock('../BrowserRuntimeClient', () => ({
  BrowserRuntimeClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    register: mockRegister,
    startHeartbeat: mockStartHeartbeat,
    stopHeartbeat: mockStopHeartbeat,
    disconnect: mockDisconnect,
    onToolInvoke: mockOnToolInvoke,
    onRehydrate: mockOnRehydrate,
    onDisconnect: mockOnDisconnect,
    onConnect: mockOnConnect,
    emitToolCompleted: mockEmitToolCompleted,
    emitToolFailed: mockEmitToolFailed,
    emitToolProgress: mockEmitToolProgress,
    connected: true,
  })),
}));

const mockBoot = vi.fn().mockResolvedValue(undefined);
const mockEnsureDeps = vi.fn().mockResolvedValue({ installed: true });
const mockStartDevServer = vi.fn().mockResolvedValue('http://localhost:5173');
const mockShaManifest = vi.fn().mockResolvedValue(new Map([['package.json', 'sha-a']]));
const mockMarkDepsDirty = vi.fn();

vi.mock('../NodepodRuntimeAdapter', () => ({
  NodepodRuntimeAdapter: vi.fn().mockImplementation(() => ({
    boot: mockBoot,
    ensureDeps: mockEnsureDeps,
    startDevServer: mockStartDevServer,
    shaManifest: mockShaManifest,
    markDepsDirty: mockMarkDepsDirty,
    files: { '/package.json': '{}' },
    teardown: vi.fn(),
    currentPod: null,
  })),
  invalidateSession: vi.fn(),
}));

const mockHydrateStarter = vi
  .fn()
  .mockReturnValue({ '/package.json': '{}', '/src/App.jsx': 'app' });
const mockHydrateFromRevision = vi.fn().mockResolvedValue({
  '/package.json': '{"name":"from-ceph"}',
  '/src/App.jsx': 'app',
});
const mockSyncToRevision = vi.fn().mockResolvedValue(undefined);

vi.mock('../RevisionHydrator', () => ({
  RevisionHydrator: vi.fn().mockImplementation(() => ({
    hydrateStarter: mockHydrateStarter,
    hydrateFromRevision: mockHydrateFromRevision,
    hydrateFromCeph: vi.fn().mockResolvedValue({ '/package.json': '{}' }),
    syncToRevision: mockSyncToRevision,
  })),
}));

const mockAttachIframe = vi.fn().mockResolvedValue(undefined);
const mockDetachIframe = vi.fn();

vi.mock('../PreviewController', () => ({
  PreviewController: vi.fn().mockImplementation(() => ({
    previewUrl: 'http://localhost:5173',
    port: 5173,
    setPreview: vi.fn(),
    reset: vi.fn(),
    attachIframe: mockAttachIframe,
    detachIframe: mockDetachIframe,
    probeAndPromote: vi.fn().mockResolvedValue({ ok: true }),
    inspectPreview: vi.fn().mockResolvedValue({ url: 'http://localhost:5173', healthy: true }),
    performAction: vi.fn().mockResolvedValue({ ok: true, action: 'reload' }),
  })),
}));

// Hoisted: the mock factory dereferences it eagerly at module-eval time.
const { mockDispatchTool } = vi.hoisted(() => ({
  mockDispatchTool: vi.fn().mockResolvedValue({ content: 'ok' }),
}));

vi.mock('../RuntimeToolHandlers', () => ({
  dispatchTool: mockDispatchTool,
  MUTATING_TOOLS: new Set(['write', 'apply_patch', 'delete']),
}));

vi.mock('../../store', () => ({
  useConversationV2Store: {
    getState: () => ({
      applicationComponent: null,
      setRightPanelView: vi.fn(),
    }),
  },
}));

vi.mock('../RuntimeCapabilities', () => ({
  NODEPOD_CAPABILITIES: {
    filesystem: true,
    npm: true,
    previewInspection: true,
    nativeBinaries: false,
  },
}));

describe('BrowserRuntimeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHydrateFromRevision.mockResolvedValue({
      '/package.json': '{"name":"from-ceph"}',
      '/src/App.jsx': 'app',
    });
    mockConnect.mockResolvedValue(undefined);
    mockRegister.mockResolvedValue({ ok: true });
    mockBoot.mockResolvedValue(undefined);
    mockEnsureDeps.mockResolvedValue({ installed: true });
    mockStartDevServer.mockResolvedValue('http://localhost:5173');
    mockShaManifest.mockResolvedValue(new Map([['package.json', 'sha-a']]));
    mockDispatchTool.mockResolvedValue({ content: 'ok' });
  });

  afterEach(() => {
    removeHost('sess_1');
  });

  it('full lifecycle: ticket -> connect -> hydrate -> boot -> install -> register -> ready', async () => {
    const host = new BrowserRuntimeHost();
    const states: string[] = [];
    host.subscribe((s) => states.push(s.status));

    await host.start('sess_1');

    expect(mockConnect).toHaveBeenCalledWith('ticket_123');
    expect(mockBoot).toHaveBeenCalled();
    expect(mockEnsureDeps).toHaveBeenCalled();
    expect(mockStartDevServer).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: 'rts_abc',
        workspaceId: 'ws_1',
        revisionId: 'starter_react_vite_v1',
      }),
    );
    expect(mockStartHeartbeat).toHaveBeenCalledWith('ws_1', expect.any(Function));

    expect(host.state.status).toBe('ready');
    expect(states).toContain('connecting');
    expect(states).toContain('hydrating');
    expect(states).toContain('installing');
    expect(states).toContain('starting');
    expect(states).toContain('registering');
    expect(states).toContain('ready');

    // Ticket / mcpToken must never surface on HostState (isolation for preview iframe).
    expect(Object.keys(host.state).sort()).toEqual([
      'error',
      'files',
      'previewUrl',
      'revisionId',
      'status',
    ]);
    expect(JSON.stringify(host.state)).not.toContain('ticket');
    expect(JSON.stringify(host.state)).not.toContain('mcpToken');
    expect(host.state.previewUrl).not.toMatch(/ticket/i);

    host.destroy();
  });

  it('reports error when registration fails', async () => {
    mockRegister.mockResolvedValueOnce({ ok: false, error: 'bad ticket' });

    const host = new BrowserRuntimeHost();
    await host.start('sess_1');

    expect(host.state.status).toBe('error');
    expect(host.state.error).toContain('Registration failed');
    host.destroy();
  });

  it('getOrCreateHost returns same instance for same sessionId', () => {
    const a = getOrCreateHost('sess_x');
    const b = getOrCreateHost('sess_x');
    expect(a).toBe(b);
    removeHost('sess_x');
  });

  it('removeHost destroys and removes the host', () => {
    const host = getOrCreateHost('sess_y');
    expect(host).toBeDefined();
    removeHost('sess_y');
    const newHost = getOrCreateHost('sess_y');
    expect(newHost).not.toBe(host);
    removeHost('sess_y');
  });

  it('seeds the local revision store at the ticket revision', async () => {
    const host = new BrowserRuntimeHost();
    await host.start('sess_1');
    expect(mockShaManifest).toHaveBeenCalled();
    expect(host.state.revisionId).toBe('starter_react_vite_v1');
    expect(mockHydrateFromRevision).toHaveBeenCalledWith('sess_1', 'starter_react_vite_v1');
    expect(mockHydrateStarter).not.toHaveBeenCalled();
    host.destroy();
  });

  it('fails startup when Ceph revision hydration is unavailable', async () => {
    mockHydrateFromRevision.mockRejectedValueOnce(new Error('ceph down'));
    const host = new BrowserRuntimeHost();
    await host.start('sess_1');
    expect(mockHydrateStarter).not.toHaveBeenCalled();
    expect(host.state.status).toBe('error');
    host.destroy();
  });

  describe('tool.invoke', () => {
    /** Run the handler the host registered with the socket client. */
    async function invoke(payload: Record<string, unknown>) {
      const handler = mockOnToolInvoke.mock.calls[0][0] as (p: unknown) => void;
      handler(payload);
      await vi.waitFor(() =>
        expect(
          mockEmitToolCompleted.mock.calls.length + mockEmitToolFailed.mock.calls.length,
        ).toBeGreaterThan(0),
      );
    }

    it('emits tool.completed with the handler result', async () => {
      const host = new BrowserRuntimeHost();
      await host.start('sess_1');

      await invoke({
        toolCallId: 'tc_1',
        tool: 'read',
        arguments: { path: 'src/App.tsx' },
      });

      expect(mockEmitToolCompleted).toHaveBeenCalledWith({
        toolCallId: 'tc_1',
        result: { content: 'ok' },
      });
      host.destroy();
    });

    it('forwards a ToolError code on tool.failed', async () => {
      mockDispatchTool.mockRejectedValueOnce(
        new ToolError(RuntimeErrorCodes.SECURITY_DENIED, 'nope', { path: '../x' }),
      );
      const host = new BrowserRuntimeHost();
      await host.start('sess_1');

      await invoke({ toolCallId: 'tc_2', tool: 'read', arguments: { path: '../x' } });

      expect(mockEmitToolFailed).toHaveBeenCalledWith({
        toolCallId: 'tc_2',
        error: {
          code: RuntimeErrorCodes.SECURITY_DENIED,
          message: 'nope',
          data: { path: '../x' },
        },
      });
      host.destroy();
    });

    it('advances the reported revision after a mutation', async () => {
      // Mirror what the real write handler does: commit through the store.
      mockDispatchTool.mockImplementationOnce(async (_tool, _args, ctx) => {
        const revisions = (ctx as { revisions: { commit: (m: Map<string, string>) => string } })
          .revisions;
        return { revisionId: revisions.commit(new Map([['a.txt', 'sha-b']])) };
      });

      const host = new BrowserRuntimeHost();
      await host.start('sess_1');
      expect(host.state.revisionId).toBe('starter_react_vite_v1');

      await invoke({
        toolCallId: 'tc_3',
        tool: 'write',
        arguments: { path: 'a.txt', content: 'x', create: true },
      });

      expect(host.state.revisionId).toBe('rev_1');
      host.destroy();
    });

    it('relays tool.progress through the injected reporter', async () => {
      mockDispatchTool.mockReset();
      mockDispatchTool.mockImplementation(async (_tool, _args, ctx) => {
        (ctx as { onProgress?: (p: unknown) => void }).onProgress?.({
          phase: 'running',
          message: 'building',
        });
        return { exitCode: 0 };
      });
      const host = new BrowserRuntimeHost();
      await host.start('sess_1');

      await invoke({ toolCallId: 'tc_4', tool: 'run', arguments: { command: 'ls' } });

      expect(mockEmitToolProgress).toHaveBeenCalledWith({
        toolCallId: 'tc_4',
        phase: 'running',
        message: 'building',
      });
      host.destroy();
    });
  });

  describe('runtime.rehydrate', () => {
    it('re-syncs the VFS and re-registers at the expected revision', async () => {
      const host = new BrowserRuntimeHost();
      await host.start('sess_1');
      mockRegister.mockClear();

      const handler = mockOnRehydrate.mock.calls[0][0] as (p: unknown) => void;
      handler({
        workspaceId: 'ws_1',
        expectedRevisionId: 'rev_5',
        actualRevisionId: 'rev_0',
      });

      await vi.waitFor(() => expect(mockRegister).toHaveBeenCalled());
      expect(mockHydrateFromRevision).toHaveBeenCalledWith('sess_1', 'rev_5');
      expect(mockMarkDepsDirty).toHaveBeenCalled();
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({ revisionId: 'rev_5' }),
      );
      expect(host.state.revisionId).toBe('rev_5');
      host.destroy();
    });
  });

  it('queues a preview iframe until the pod exists', async () => {
    const host = new BrowserRuntimeHost();
    const iframe = document.createElement('iframe');

    host.attachPreviewIframe(iframe);
    // No pod yet, so nothing is handed to the controller.
    expect(mockAttachIframe).not.toHaveBeenCalled();

    host.detachPreviewIframe();
    expect(mockDetachIframe).toHaveBeenCalled();
    host.destroy();
  });

  it('subscribe/unsubscribe works correctly', async () => {
    const host = new BrowserRuntimeHost();
    const listener = vi.fn();
    const unsub = host.subscribe(listener);

    await host.start('sess_1');

    expect(listener).toHaveBeenCalled();
    unsub();
    listener.mockClear();
    host.retry();
    await new Promise((r) => setTimeout(r, 50));
    expect(listener).not.toHaveBeenCalled();
    host.destroy();
  });

  it('keeps subscribers attached across retry', async () => {
    const host = new BrowserRuntimeHost();
    const states: string[] = [];
    host.subscribe((s) => states.push(s.status));

    await host.start('sess_1');
    expect(states.at(-1)).toBe('ready');

    host.retry();
    await vi.waitFor(() => {
      expect(states.filter((status) => status === 'ready').length).toBeGreaterThanOrEqual(2);
    });
    expect(states).toContain('idle');
    expect(states).toContain('connecting');
    host.destroy();
  });
});
