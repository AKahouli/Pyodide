import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';

const mockGrpcClient = {
  CreateSession: jest.fn(),
  RunTask: jest.fn(),
  GetSession: jest.fn(),
  StopSession: jest.fn(),
  close: jest.fn(),
};

jest.mock('@grpc/grpc-js', () => {
  const actual = jest.requireActual('@grpc/grpc-js');
  return {
    ...actual,
    credentials: { createInsecure: jest.fn(() => 'insecure') },
  };
});

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

describe('WorkyOrchestratorGrpcClientService', () => {
  let service: WorkyOrchestratorGrpcClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkyOrchestratorGrpcClientService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                'workyOrchestrator.grpcUrl': 'localhost:50052',
                'workyOrchestrator.grpcMaxMessageBytes': 16 * 1024 * 1024,
                'workyOrchestrator.grpcUnaryDeadlineMs': 15000,
                'workyOrchestrator.grpcIdleTimeoutMs': 120000,
              };
              return map[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(WorkyOrchestratorGrpcClientService);
    (service as unknown as { client: typeof mockGrpcClient }).client = mockGrpcClient;
    Object.values(mockGrpcClient).forEach((fn) => (fn as jest.Mock).mockReset?.());
  });

  describe('createSession', () => {
    it('calls CreateSession with positional metadata + deadline and resolves session_id', async () => {
      mockGrpcClient.CreateSession.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1' }),
      );

      const id = await service.createSession('user-1');

      expect(id).toBe('sess-1');
      const [req, md, opts] = mockGrpcClient.CreateSession.mock.calls[0];
      expect(req).toEqual({ user_id: 'user-1' });
      expect(md).toBeDefined(); // grpc.Metadata, passed positionally
      expect(opts).toHaveProperty('deadline');
    });

    it('rejects when CreateSession errors', async () => {
      mockGrpcClient.CreateSession.mockImplementation((_req, _md, _opts, cb) =>
        cb(new Error('boom')),
      );
      await expect(service.createSession('user-1')).rejects.toThrow('boom');
    });
  });

  describe('runTask', () => {
    it('calls RunTask with the agents array and resolves the mapped response', async () => {
      mockGrpcClient.RunTask.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1', accepted: true, run_id: 'run-1' }),
      );

      const agents = [{ id: 'planner-1' }, { id: 'executor-1' }];
      const result = await service.runTask('user-1', 'sess-1', 'do the thing', {
        agents,
        connectors: [{ connector_id: 'c1' }],
        turnId: 'turn-1',
      });

      expect(result).toEqual({ sessionId: 'sess-1', accepted: true, runId: 'run-1' });
      const [req, md, opts] = mockGrpcClient.RunTask.mock.calls[0];
      expect(req).toMatchObject({
        user_id: 'user-1',
        session_id: 'sess-1',
        message: 'do the thing',
        agents,
        connectors: [{ connector_id: 'c1' }],
        turn_id: 'turn-1',
      });
      expect(req).not.toHaveProperty('planner_model');
      expect(req).not.toHaveProperty('executor_model');
      expect(req).not.toHaveProperty('model');
      expect(md).toBeDefined();
      expect(opts).toHaveProperty('deadline');
    });

    it('omits agents/skills/connectors when not provided', async () => {
      mockGrpcClient.RunTask.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1', accepted: true, run_id: 'run-1' }),
      );

      await service.runTask('user-1', 'sess-1', 'do the thing', {});

      const [req] = mockGrpcClient.RunTask.mock.calls[0];
      expect(req).toEqual({
        user_id: 'user-1',
        session_id: 'sess-1',
        message: 'do the thing',
      });
    });

    it('rejects when RunTask errors', async () => {
      mockGrpcClient.RunTask.mockImplementation((_req, _md, _opts, cb) => cb(new Error('boom')));
      await expect(
        service.runTask('user-1', 'sess-1', 'm', {}),
      ).rejects.toThrow('boom');
    });
  });

  describe('getSession', () => {
    it('calls GetSession and resolves the mapped snapshot', async () => {
      const plan = { id: 'p1', title: 't', goal: 'g', status: 'running', steps: [] };
      mockGrpcClient.GetSession.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1', title: 'Session Title', status: 'running', plan }),
      );

      const result = await service.getSession('user-1', 'sess-1');

      expect(result).toEqual({
        sessionId: 'sess-1',
        title: 'Session Title',
        status: 'running',
        plan,
      });
      const [req, md, opts] = mockGrpcClient.GetSession.mock.calls[0];
      expect(req).toEqual({ user_id: 'user-1', session_id: 'sess-1' });
      expect(md).toBeDefined();
      expect(opts).toHaveProperty('deadline');
    });

    it('rejects when GetSession errors', async () => {
      mockGrpcClient.GetSession.mockImplementation((_req, _md, _opts, cb) => cb(new Error('boom')));
      await expect(service.getSession('user-1', 'sess-1')).rejects.toThrow('boom');
    });
  });

  describe('stopSession', () => {
    it('calls StopSession with positional metadata + deadline and resolves stopped', async () => {
      mockGrpcClient.StopSession.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { stopped: true }),
      );

      const result = await service.stopSession('user-1', 'sess-1');

      expect(result).toEqual({ stopped: true });
      const [req, md, opts] = mockGrpcClient.StopSession.mock.calls[0];
      expect(req).toEqual({ user_id: 'user-1', session_id: 'sess-1' });
      expect(md).toBeDefined();
      expect(opts).toHaveProperty('deadline');
    });

    it('rejects when StopSession errors', async () => {
      mockGrpcClient.StopSession.mockImplementation((_req, _md, _opts, cb) => cb(new Error('boom')));
      await expect(service.stopSession('user-1', 'sess-1')).rejects.toThrow('boom');
    });
  });
});
