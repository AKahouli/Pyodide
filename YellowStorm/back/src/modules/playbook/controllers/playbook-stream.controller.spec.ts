import { Subject, of } from 'rxjs';
import { PlaybookStreamController } from './playbook-stream.controller';
import { PlaybookStreamGatewayService } from '../services/playbook-stream-gateway.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

describe('PlaybookStreamController', () => {
  let controller: PlaybookStreamController;
  let streamGateway: jest.Mocked<
    Pick<PlaybookStreamGatewayService, 'registerConnection' | 'removeConnection'>
  >;
  let executionService: jest.Mocked<
    Pick<PlaybookExecutionService, 'findActiveExecutionsByUser'>
  >;

  const sseUser: JwtPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    type: 'access',
    sessionId: 'session-456',
    permissions: [],
    roleNames: ['user'],
    permissionsVersion: 1,
  };

  const createMockRequest = (user: JwtPayload) => {
    const listeners: Record<string, Function[]> = {};
    return {
      sseUser: user,
      on: jest.fn((event: string, cb: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      _emit: (event: string) => listeners[event]?.forEach((cb) => cb()),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    streamGateway = {
      registerConnection: jest.fn().mockReturnValue(new Subject().asObservable()),
      removeConnection: jest.fn(),
    };

    executionService = {
      findActiveExecutionsByUser: jest.fn().mockResolvedValue([]),
    };

    controller = new PlaybookStreamController(
      streamGateway as unknown as PlaybookStreamGatewayService,
      executionService as unknown as PlaybookExecutionService,
    );
  });

  it('should register a connection via streamGateway', async () => {
    const req = createMockRequest(sseUser);

    await controller.stream(req as any);

    expect(streamGateway.registerConnection).toHaveBeenCalledWith(
      'user-123',
      expect.stringContaining('playbook:user-123:session-456:'),
      expect.any(Subject),
    );
  });

  it('should fetch active executions on connect', async () => {
    const req = createMockRequest(sseUser);

    await controller.stream(req as any);

    expect(executionService.findActiveExecutionsByUser).toHaveBeenCalledWith('user-123');
  });

  it('should clean up connection on request close', async () => {
    const req = createMockRequest(sseUser);

    await controller.stream(req as any);

    // Simulate the client disconnecting
    req._emit('close');

    expect(streamGateway.removeConnection).toHaveBeenCalledWith(
      'user-123',
      expect.stringContaining('playbook:user-123:session-456:'),
    );
  });

  it('should return error observable when connection limit is reached', async () => {
    streamGateway.registerConnection.mockReturnValue(null);
    const req = createMockRequest(sseUser);

    const result = await controller.stream(req as any);

    // The observable should emit an error event
    const events: any[] = [];
    result.subscribe((event) => events.push(event));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].data.code).toBe('ERR_1405');
  });

  it('should use "unknown" when sessionId is absent', async () => {
    const userWithoutSession = { ...sseUser, sessionId: undefined } as any;
    const req = createMockRequest(userWithoutSession);

    await controller.stream(req as any);

    expect(streamGateway.registerConnection).toHaveBeenCalledWith(
      'user-123',
      expect.stringContaining('playbook:user-123:unknown:'),
      expect.any(Subject),
    );
  });
});
