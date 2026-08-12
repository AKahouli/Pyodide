import {
  GATEWAY_METADATA,
  GATEWAY_OPTIONS,
  MESSAGE_MAPPING_METADATA,
  MESSAGE_METADATA,
} from '@nestjs/websockets/constants';
import type { RuntimeBindingService } from '../services/runtime-binding.service';
import type { RuntimeConnectionRegistry } from '../services/runtime-connection.registry';
import type { RuntimeTicketService } from '../services/runtime-ticket.service';
import type { RuntimeToolDispatcherService } from '../services/runtime-tool-dispatcher.service';
import { AppRuntimeGateway, RuntimeSocket } from './app-runtime.gateway';

const CONSUMED_TICKET = {
  runtimeSessionId: 'rts_1',
  bindingId: 'arb_1',
  workspaceId: 'sess_1',
  userId: 'user_1',
};

describe('AppRuntimeGateway', () => {
  let gateway: AppRuntimeGateway;
  let client: RuntimeSocket;

  const consume = jest.fn();
  const markBrowserActive = jest.fn();
  const markWaitingForBrowser = jest.fn();
  const touchHeartbeat = jest.fn();
  const register = jest.fn();
  const unregister = jest.fn();
  const touch = jest.fn();
  const markHeartbeatFlushed = jest.fn();
  const failPendingForWorkspace = jest.fn();
  const handleProgress = jest.fn();
  const handleCompleted = jest.fn();
  const handleFailed = jest.fn();

  const socketWith = (handshake: Record<string, unknown>): RuntimeSocket =>
    ({
      id: 's1',
      handshake: { auth: {}, headers: {}, ...handshake },
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: undefined,
    }) as unknown as RuntimeSocket;

  const authenticated = (): RuntimeSocket => {
    const socket = socketWith({});
    socket.data = { ...CONSUMED_TICKET, registered: false };
    return socket;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    register.mockReturnValue(null);
    touch.mockReturnValue({ lastHeartbeatFlushAt: 0 });

    gateway = new AppRuntimeGateway(
      { consume } as unknown as RuntimeTicketService,
      {
        markBrowserActive,
        markWaitingForBrowser,
        touchHeartbeat,
      } as unknown as RuntimeBindingService,
      {
        register,
        unregister,
        touch,
        markHeartbeatFlushed,
      } as unknown as RuntimeConnectionRegistry,
      {
        failPendingForWorkspace,
        handleProgress,
        handleCompleted,
        handleFailed,
      } as unknown as RuntimeToolDispatcherService,
    );

    client = authenticated();
  });

  describe('wiring', () => {
    it('serves the /app-runtime namespace with credentialed CORS', () => {
      expect(Reflect.getMetadata(GATEWAY_METADATA, AppRuntimeGateway)).toBe(true);
      expect(Reflect.getMetadata(GATEWAY_OPTIONS, AppRuntimeGateway)).toEqual({
        namespace: '/app-runtime',
        cors: { origin: true, credentials: true },
      });
    });

    it.each([
      ['handleRegister', 'runtime.register'],
      ['handleHeartbeat', 'runtime.heartbeat'],
      ['handleToolProgress', 'tool.progress'],
      ['handleToolCompleted', 'tool.completed'],
      ['handleToolFailed', 'tool.failed'],
    ])('binds %s to the %s event', (method, event) => {
      const handler = (AppRuntimeGateway.prototype as unknown as Record<string, object>)[
        method
      ];
      expect(Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)).toBe(true);
      expect(Reflect.getMetadata(MESSAGE_METADATA, handler)).toBe(event);
    });
  });

  describe('handshake', () => {
    it('rejects a connection without a ticket', async () => {
      const socket = socketWith({});

      await gateway.handleConnection(socket);

      expect(consume).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects an expired or already consumed ticket', async () => {
      consume.mockResolvedValueOnce(null);
      const socket = socketWith({ auth: { ticket: 'replayed' } });

      await gateway.handleConnection(socket);

      expect(consume).toHaveBeenCalledWith('replayed');
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data).toBeUndefined();
    });

    it('binds the socket to the workspace carried by the ticket', async () => {
      consume.mockResolvedValueOnce(CONSUMED_TICKET);
      const socket = socketWith({ auth: { ticket: 'valid' } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data).toEqual({ ...CONSUMED_TICKET, registered: false });
    });

    it('accepts the ticket from the x-runtime-ticket header', async () => {
      consume.mockResolvedValueOnce(CONSUMED_TICKET);
      const socket = socketWith({ headers: { 'x-runtime-ticket': 'from-header' } });

      await gateway.handleConnection(socket);

      expect(consume).toHaveBeenCalledWith('from-header');
    });
  });

  describe('runtime.register', () => {
    it('activates the binding and stores the advertised capabilities', async () => {
      const capabilities = {
        filesystem: true,
        npm: true,
        previewInspection: true,
        nativeBinaries: false,
      };

      const result = await gateway.handleRegister(client, {
        runtimeSessionId: 'rts_1',
        workspaceId: 'sess_1',
        revisionId: 'rev_2',
        capabilities,
      });

      expect(result).toEqual({ ok: true });
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'sess_1',
          bindingId: 'arb_1',
          revisionId: 'rev_2',
          capabilities,
        }),
      );
      expect(markBrowserActive).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'sess_1', capabilities }),
      );
      expect(client.data.registered).toBe(true);
    });

    it('drops a socket claiming another workspace', async () => {
      const result = await gateway.handleRegister(client, {
        runtimeSessionId: 'rts_1',
        workspaceId: 'sess_someone_else',
        revisionId: 'rev_0',
        capabilities: {},
      });

      expect(result).toEqual({ ok: false, error: 'SESSION_MISMATCH' });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(register).not.toHaveBeenCalled();
      expect(markBrowserActive).not.toHaveBeenCalled();
    });

    it('drops a socket replaying another runtime session id', async () => {
      const result = await gateway.handleRegister(client, {
        runtimeSessionId: 'rts_other',
        workspaceId: 'sess_1',
        revisionId: 'rev_0',
        capabilities: {},
      });

      expect(result).toEqual({ ok: false, error: 'SESSION_MISMATCH' });
      expect(register).not.toHaveBeenCalled();
    });

    it('disconnects the previous browser tab for the workspace', async () => {
      const evicted = { socket: { disconnect: jest.fn() } };
      register.mockReturnValueOnce(evicted);

      await gateway.handleRegister(client, {
        runtimeSessionId: 'rts_1',
        workspaceId: 'sess_1',
        revisionId: 'rev_0',
        capabilities: {},
      });

      expect(evicted.socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('runtime.heartbeat', () => {
    it('refreshes the in-memory connection without writing to Mongo every time', async () => {
      touch.mockReturnValue({ lastHeartbeatFlushAt: Date.now() });

      const result = await gateway.handleHeartbeat(client, {
        workspaceId: 'sess_1',
        revisionId: 'rev_3',
      });

      expect(result).toEqual({ ok: true });
      expect(touch).toHaveBeenCalledWith('sess_1', 'rev_3');
      expect(touchHeartbeat).not.toHaveBeenCalled();
    });

    it('flushes to Mongo once the throttle window has elapsed', async () => {
      touch.mockReturnValue({ lastHeartbeatFlushAt: Date.now() - 20_000 });

      await gateway.handleHeartbeat(client, { workspaceId: 'sess_1' });

      expect(touchHeartbeat).toHaveBeenCalledWith('sess_1', expect.any(Date));
      expect(markHeartbeatFlushed).toHaveBeenCalled();
    });

    it('ignores a heartbeat for another workspace', async () => {
      const result = await gateway.handleHeartbeat(client, {
        workspaceId: 'sess_other',
      });

      expect(result).toEqual({ ok: false });
      expect(touch).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('parks the binding and fails in-flight calls', async () => {
      unregister.mockReturnValueOnce(true);

      await gateway.handleDisconnect(client);

      expect(unregister).toHaveBeenCalledWith('sess_1', 's1');
      expect(failPendingForWorkspace).toHaveBeenCalledWith(
        'sess_1',
        'Browser runtime disconnected',
      );
      expect(markWaitingForBrowser).toHaveBeenCalledWith('sess_1');
    });

    it('leaves the binding active when a newer socket already took over', async () => {
      unregister.mockReturnValueOnce(false);

      await gateway.handleDisconnect(client);

      expect(markWaitingForBrowser).not.toHaveBeenCalled();
    });

    it('does nothing for a socket that never authenticated', async () => {
      await gateway.handleDisconnect(socketWith({}));

      expect(unregister).not.toHaveBeenCalled();
      expect(failPendingForWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('tool events', () => {
    it('forwards outcomes to the dispatcher scoped to the socket workspace', () => {
      gateway.handleToolProgress(client, { toolCallId: 'tc_1' });
      gateway.handleToolCompleted(client, { toolCallId: 'tc_1', result: {} });
      gateway.handleToolFailed(client, {
        toolCallId: 'tc_1',
        error: { code: -32007, message: 'boom' },
      });

      expect(handleProgress).toHaveBeenCalledWith('sess_1', { toolCallId: 'tc_1' });
      expect(handleCompleted).toHaveBeenCalledWith('sess_1', {
        toolCallId: 'tc_1',
        result: {},
      });
      expect(handleFailed).toHaveBeenCalledWith('sess_1', {
        toolCallId: 'tc_1',
        error: { code: -32007, message: 'boom' },
      });
    });

    it('ignores tool events from an unauthenticated socket', () => {
      gateway.handleToolCompleted(socketWith({}), { toolCallId: 'tc_1', result: {} });

      expect(handleCompleted).not.toHaveBeenCalled();
    });
  });
});
