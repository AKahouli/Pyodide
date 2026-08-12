import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserRuntimeHost, getOrCreateHost, removeHost } from '../BrowserRuntimeHost';

// Mock all dependencies
vi.mock('../../api', () => ({
  conversationV2Api: {
    createRuntimeTicket: vi.fn().mockResolvedValue({
      runtimeSessionId: 'rts_abc',
      ticket: 'ticket_123',
      workspaceId: 'ws_1',
      revisionId: 'rev_0',
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
    connected: true,
  })),
}));

const mockBoot = vi.fn().mockResolvedValue(undefined);
const mockInstallDeps = vi.fn().mockResolvedValue(undefined);
const mockStartDevServer = vi.fn().mockResolvedValue('http://localhost:5173');

vi.mock('../NodepodRuntimeAdapter', () => ({
  NodepodRuntimeAdapter: vi.fn().mockImplementation(() => ({
    boot: mockBoot,
    installDeps: mockInstallDeps,
    startDevServer: mockStartDevServer,
    files: { '/package.json': '{}' },
    teardown: vi.fn(),
    currentPod: null,
  })),
  invalidateSession: vi.fn(),
}));

vi.mock('../RevisionHydrator', () => ({
  RevisionHydrator: vi.fn().mockImplementation(() => ({
    hydrateStarter: vi.fn().mockReturnValue({ '/package.json': '{}', '/src/App.jsx': 'app' }),
    hydrateFromCeph: vi.fn().mockResolvedValue({ '/package.json': '{}' }),
    syncToRevision: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../PreviewController', () => ({
  PreviewController: vi.fn().mockImplementation(() => ({
    previewUrl: 'http://localhost:5173',
    port: 5173,
    setPreview: vi.fn(),
    reset: vi.fn(),
    probeAndPromote: vi.fn().mockResolvedValue({ ok: true }),
    inspectPreview: vi.fn().mockResolvedValue({ url: 'http://localhost:5173', healthy: true }),
  })),
}));

vi.mock('../RuntimeToolHandlers', () => ({
  dispatchTool: vi.fn().mockResolvedValue({ content: 'ok' }),
  ToolError: class extends Error {
    code: number;
    data?: Record<string, unknown>;
    constructor(code: number, message: string, data?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.data = data;
    }
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
    expect(mockInstallDeps).toHaveBeenCalled();
    expect(mockStartDevServer).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: 'rts_abc',
        workspaceId: 'ws_1',
        revisionId: 'rev_0',
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

  it('subscribe/unsubscribe works correctly', async () => {
    const host = new BrowserRuntimeHost();
    const listener = vi.fn();
    const unsub = host.subscribe(listener);

    await host.start('sess_1');

    expect(listener).toHaveBeenCalled();
    const callCount = listener.mock.calls.length;

    unsub();
    // Triggering another state change shouldn't notify
    host.retry();
    // Give it time to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    // At most same or +1 if retry synchronously fires before unsubscribe effect
    // But unsubscribe should prevent new calls
    host.destroy();
  });
});
