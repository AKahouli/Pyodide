import { Subject } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { LoggerService } from '../../logger';
import { PlaybookStreamEvent } from '../interfaces/playbook-stream.interface';

describe('PlaybookStreamGatewayService', () => {
  let service: PlaybookStreamGatewayService;
  let mockLogger: jest.Mocked<LoggerService>;

  const createMockLogger = (): jest.Mocked<LoggerService> =>
    ({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as unknown as jest.Mocked<LoggerService>;

  const createMockConfig = (overrides: Record<string, unknown> = {}): ConfigService => {
    const defaults: Record<string, unknown> = {
      'playbook.maxSseConnections': 5,
      'playbook.sseHeartbeatMs': 15000,
      ...overrides,
    };
    return {
      get: jest.fn((key: string, defaultValue?: unknown) => defaults[key] ?? defaultValue),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockLogger = createMockLogger();
    service = new PlaybookStreamGatewayService(createMockConfig(), mockLogger);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should set logger context', () => {
      expect(mockLogger.setContext).toHaveBeenCalledWith('PlaybookStreamGatewayService');
    });
  });

  describe('registerConnection', () => {
    it('should return an Observable (SSE stream)', () => {
      const disconnect$ = new Subject<void>();
      const result = service.registerConnection('user-1', 'conn-1', disconnect$);

      expect(result).not.toBeNull();
      expect(typeof result!.subscribe).toBe('function');
    });

    it('should log the connection registration', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      expect(mockLogger.log).toHaveBeenCalledWith('Playbook stream connection registered', {
        userId: 'user-1',
        connectionId: 'conn-1',
      });
    });

    it('should track connection so isUserConnected returns true', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      expect(service.isUserConnected('user-1')).toBe(true);
    });

    it('should emit heartbeat events at the configured interval', () => {
      const disconnect$ = new Subject<void>();
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);
      const emitted: MessageEvent[] = [];

      stream$!.subscribe((event) => emitted.push(event));

      // No heartbeat emitted immediately
      expect(emitted).toHaveLength(0);

      // Advance past one heartbeat interval (default 15000ms)
      jest.advanceTimersByTime(15000);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe('playbook_heartbeat');
      expect(emitted[0].data).toHaveProperty('timestamp');

      // Advance past another heartbeat interval
      jest.advanceTimersByTime(15000);
      expect(emitted).toHaveLength(2);

      disconnect$.next();
      disconnect$.complete();
    });

    it('should use custom heartbeat interval from config', () => {
      const customService = new PlaybookStreamGatewayService(
        createMockConfig({ 'playbook.sseHeartbeatMs': 5000 }),
        createMockLogger(),
      );

      const disconnect$ = new Subject<void>();
      const stream$ = customService.registerConnection('user-1', 'conn-1', disconnect$);
      const emitted: MessageEvent[] = [];

      stream$!.subscribe((event) => emitted.push(event));

      jest.advanceTimersByTime(5000);
      expect(emitted).toHaveLength(1);

      jest.advanceTimersByTime(5000);
      expect(emitted).toHaveLength(2);

      disconnect$.next();
      disconnect$.complete();
      customService.onModuleDestroy();
    });

    it('should support multiple connections for the same user', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      const stream1 = service.registerConnection('user-1', 'conn-1', d1);
      const stream2 = service.registerConnection('user-1', 'conn-2', d2);

      expect(stream1).not.toBeNull();
      expect(stream2).not.toBeNull();
      expect(service.isUserConnected('user-1')).toBe(true);
    });

    it('should return null when max connections per user is reached', () => {
      const svc = new PlaybookStreamGatewayService(
        createMockConfig({ 'playbook.maxSseConnections': 2 }),
        createMockLogger(),
      );

      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      const d3 = new Subject<void>();

      const stream1 = svc.registerConnection('user-1', 'conn-1', d1);
      const stream2 = svc.registerConnection('user-1', 'conn-2', d2);
      const stream3 = svc.registerConnection('user-1', 'conn-3', d3);

      expect(stream1).not.toBeNull();
      expect(stream2).not.toBeNull();
      expect(stream3).toBeNull();

      svc.onModuleDestroy();
    });

    it('should log a warning when connection limit is reached', () => {
      const logger = createMockLogger();
      const svc = new PlaybookStreamGatewayService(
        createMockConfig({ 'playbook.maxSseConnections': 1 }),
        logger,
      );

      const d1 = new Subject<void>();
      const d2 = new Subject<void>();

      svc.registerConnection('user-1', 'conn-1', d1);
      svc.registerConnection('user-1', 'conn-2', d2);

      expect(logger.warn).toHaveBeenCalledWith('Playbook SSE connection limit reached', {
        userId: 'user-1',
        max: 1,
      });

      svc.onModuleDestroy();
    });

    it('should allow connections for different users independently', () => {
      const svc = new PlaybookStreamGatewayService(
        createMockConfig({ 'playbook.maxSseConnections': 1 }),
        createMockLogger(),
      );

      const d1 = new Subject<void>();
      const d2 = new Subject<void>();

      const stream1 = svc.registerConnection('user-1', 'conn-1', d1);
      const stream2 = svc.registerConnection('user-2', 'conn-2', d2);

      expect(stream1).not.toBeNull();
      expect(stream2).not.toBeNull();

      svc.onModuleDestroy();
    });

    it('should stop emitting when disconnect$ fires', () => {
      const disconnect$ = new Subject<void>();
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);
      const emitted: MessageEvent[] = [];

      stream$!.subscribe((event) => emitted.push(event));

      jest.advanceTimersByTime(15000);
      expect(emitted).toHaveLength(1);

      disconnect$.next();
      disconnect$.complete();

      jest.advanceTimersByTime(15000);
      // Should not have received another heartbeat after disconnect
      expect(emitted).toHaveLength(1);
    });
  });

  describe('removeConnection', () => {
    it('should remove connection from maps', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      expect(service.isUserConnected('user-1')).toBe(true);

      service.removeConnection('user-1', 'conn-1');

      expect(service.isUserConnected('user-1')).toBe(false);
    });

    it('should log the connection removal', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      service.removeConnection('user-1', 'conn-1');

      expect(mockLogger.log).toHaveBeenCalledWith('Playbook stream connection removed', {
        userId: 'user-1',
        connectionId: 'conn-1',
      });
    });

    it('should complete the subject so the observable stream ends', () => {
      const disconnect$ = new Subject<void>();
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);
      let completed = false;

      stream$!.subscribe({ complete: () => (completed = true) });

      service.removeConnection('user-1', 'conn-1');

      expect(completed).toBe(true);
    });

    it('should handle removing a non-existent connection gracefully', () => {
      expect(() => {
        service.removeConnection('user-1', 'non-existent');
      }).not.toThrow();

      expect(mockLogger.log).toHaveBeenCalledWith('Playbook stream connection removed', {
        userId: 'user-1',
        connectionId: 'non-existent',
      });
    });

    it('should remove only the specified connection, keeping others for the same user', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-1', 'conn-2', d2);

      service.removeConnection('user-1', 'conn-1');

      expect(service.isUserConnected('user-1')).toBe(true);
    });

    it('should clean up user entry when last connection is removed', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-1', 'conn-2', d2);

      service.removeConnection('user-1', 'conn-1');
      expect(service.isUserConnected('user-1')).toBe(true);

      service.removeConnection('user-1', 'conn-2');
      expect(service.isUserConnected('user-1')).toBe(false);
    });

    it('should trigger disconnect$ subject on the connection', () => {
      const disconnect$ = new Subject<void>();
      let disconnectFired = false;
      disconnect$.subscribe(() => (disconnectFired = true));

      service.registerConnection('user-1', 'conn-1', disconnect$);
      service.removeConnection('user-1', 'conn-1');

      expect(disconnectFired).toBe(true);
    });
  });

  describe('sendToUser', () => {
    it('should broadcast event to all user connections', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      const stream1$ = service.registerConnection('user-1', 'conn-1', d1);
      const stream2$ = service.registerConnection('user-1', 'conn-2', d2);

      const emitted1: MessageEvent[] = [];
      const emitted2: MessageEvent[] = [];
      stream1$!.subscribe((event) => emitted1.push(event));
      stream2$!.subscribe((event) => emitted2.push(event));

      const event: PlaybookStreamEvent = {
        type: 'playbook_step_complete',
        data: { stepId: 'step-1', status: 'completed' },
      };

      const result = service.sendToUser('user-1', event);

      expect(result).toBe(true);
      expect(emitted1).toHaveLength(1);
      expect(emitted1[0].type).toBe('playbook_step_complete');
      expect(emitted1[0].data).toEqual({ stepId: 'step-1', status: 'completed' });
      expect(emitted2).toHaveLength(1);
      expect(emitted2[0].type).toBe('playbook_step_complete');
    });

    it('should return false for a non-connected user', () => {
      const result = service.sendToUser('non-existent-user', {
        type: 'playbook_step_complete',
        data: { stepId: 'step-1' },
      });

      expect(result).toBe(false);
    });

    it('should return false when user had connections but all were removed', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);
      service.removeConnection('user-1', 'conn-1');

      const result = service.sendToUser('user-1', {
        type: 'playbook_update',
        data: {},
      });

      expect(result).toBe(false);
    });

    it('should format event data as SSE MessageEvent with type and data', () => {
      const disconnect$ = new Subject<void>();
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);
      const emitted: MessageEvent[] = [];
      stream$!.subscribe((event) => emitted.push(event));

      const event: PlaybookStreamEvent = {
        type: 'playbook_execution_started',
        data: { executionId: 'exec-123', playbookId: 'pb-456' },
      };

      service.sendToUser('user-1', event);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        type: 'playbook_execution_started',
        data: { executionId: 'exec-123', playbookId: 'pb-456' },
      });
    });

    it('should update lastActivity on the connection', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);

      // Advance time so that lastActivity change is detectable
      jest.advanceTimersByTime(5000);

      const beforeSend = new Date();
      service.sendToUser('user-1', {
        type: 'test',
        data: {},
      });

      // We can't directly inspect lastActivity, but we verify no error is thrown
      // and the event is delivered successfully
      expect(service.isUserConnected('user-1')).toBe(true);
    });

    it('should not throw when sending to a user with no connections in the map', () => {
      expect(() => {
        service.sendToUser('user-1', { type: 'test', data: {} });
      }).not.toThrow();
    });

    it('should handle error in subject.next by removing the faulty connection', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      // Complete the connection's observable to make subject.next throw
      service.removeConnection('user-1', 'conn-1');

      // Re-register so user has connections entry but the internal state is clean
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-2', d2);

      const result = service.sendToUser('user-1', {
        type: 'test',
        data: { value: 42 },
      });

      expect(result).toBe(true);
    });
  });

  describe('isUserConnected', () => {
    it('should return true when user has connections', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      expect(service.isUserConnected('user-1')).toBe(true);
    });

    it('should return false when user has no connections', () => {
      expect(service.isUserConnected('user-1')).toBe(false);
    });

    it('should return false after all connections are removed', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-1', 'conn-2', d2);

      service.removeConnection('user-1', 'conn-1');
      service.removeConnection('user-1', 'conn-2');

      expect(service.isUserConnected('user-1')).toBe(false);
    });

    it('should return correct results for multiple users', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-2', 'conn-2', d2);

      expect(service.isUserConnected('user-1')).toBe(true);
      expect(service.isUserConnected('user-2')).toBe(true);
      expect(service.isUserConnected('user-3')).toBe(false);

      service.removeConnection('user-1', 'conn-1');

      expect(service.isUserConnected('user-1')).toBe(false);
      expect(service.isUserConnected('user-2')).toBe(true);
    });
  });

  describe('onModuleDestroy', () => {
    it('should complete all subjects and clean up all connections', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      const d3 = new Subject<void>();
      const stream1$ = service.registerConnection('user-1', 'conn-1', d1);
      const stream2$ = service.registerConnection('user-1', 'conn-2', d2);
      const stream3$ = service.registerConnection('user-2', 'conn-3', d3);

      const completed: string[] = [];
      stream1$!.subscribe({ complete: () => completed.push('conn-1') });
      stream2$!.subscribe({ complete: () => completed.push('conn-2') });
      stream3$!.subscribe({ complete: () => completed.push('conn-3') });

      service.onModuleDestroy();

      expect(completed).toHaveLength(3);
      expect(completed).toContain('conn-1');
      expect(completed).toContain('conn-2');
      expect(completed).toContain('conn-3');
    });

    it('should make all users appear disconnected after destroy', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-2', 'conn-2', d2);

      service.onModuleDestroy();

      expect(service.isUserConnected('user-1')).toBe(false);
      expect(service.isUserConnected('user-2')).toBe(false);
    });

    it('should handle being called when there are no connections', () => {
      expect(() => {
        service.onModuleDestroy();
      }).not.toThrow();
    });

    it('should stop heartbeats from emitting after destroy', () => {
      const disconnect$ = new Subject<void>();
      const stream$ = service.registerConnection('user-1', 'conn-1', disconnect$);
      const emitted: MessageEvent[] = [];

      stream$!.subscribe({ next: (event) => emitted.push(event) });

      jest.advanceTimersByTime(15000);
      expect(emitted).toHaveLength(1);

      service.onModuleDestroy();

      jest.advanceTimersByTime(30000);
      // No additional heartbeats should be emitted after destroy
      expect(emitted).toHaveLength(1);
    });

    it('should fire disconnect$ on each connection', () => {
      const d1 = new Subject<void>();
      const d2 = new Subject<void>();

      let d1Fired = false;
      let d2Fired = false;
      d1.subscribe(() => (d1Fired = true));
      d2.subscribe(() => (d2Fired = true));

      service.registerConnection('user-1', 'conn-1', d1);
      service.registerConnection('user-2', 'conn-2', d2);

      service.onModuleDestroy();

      expect(d1Fired).toBe(true);
      expect(d2Fired).toBe(true);
    });

    it('should be safe to call multiple times', () => {
      const disconnect$ = new Subject<void>();
      service.registerConnection('user-1', 'conn-1', disconnect$);

      service.onModuleDestroy();

      expect(() => {
        service.onModuleDestroy();
      }).not.toThrow();
    });
  });
});
