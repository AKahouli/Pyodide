import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger';

// ===== Mock @grpc/grpc-js =====
const mockWaitForReady = jest.fn();
const mockGetConnectivityState = jest.fn();
const mockWatchConnectivityState = jest.fn();
const mockGetChannel = jest.fn(() => ({
  getConnectivityState: mockGetConnectivityState,
  watchConnectivityState: mockWatchConnectivityState,
}));

const mockRunStep = jest.fn();
const mockRunPlaybookWorkflow = jest.fn();
const mockResumePlaybookWorkflow = jest.fn();
const mockResumeStep = jest.fn();
const mockStopPlaybookWorkflow = jest.fn();
const mockGeneratePlaybook = jest.fn();

const MockChatbotServiceConstructor = jest.fn().mockImplementation(() => ({
  waitForReady: mockWaitForReady,
  getChannel: mockGetChannel,
  RunStep: mockRunStep,
  RunPlaybookWorkflow: mockRunPlaybookWorkflow,
  ResumePlaybookWorkflow: mockResumePlaybookWorkflow,
  ResumeStep: mockResumeStep,
  StopPlaybookWorkflow: mockStopPlaybookWorkflow,
  GeneratePlaybook: mockGeneratePlaybook,
}));

const mockCloseClient = jest.fn();
const mockCreateInsecure = jest.fn().mockReturnValue('insecure-credentials');
const mockLoadPackageDefinition = jest.fn().mockReturnValue({
  chatbot: {
    ChatbotService: MockChatbotServiceConstructor,
  },
});

jest.mock('@grpc/grpc-js', () => ({
  loadPackageDefinition: mockLoadPackageDefinition,
  credentials: { createInsecure: mockCreateInsecure },
  closeClient: mockCloseClient,
  connectivityState: {
    IDLE: 0,
    CONNECTING: 1,
    READY: 2,
    TRANSIENT_FAILURE: 3,
    SHUTDOWN: 4,
  },
}));

// ===== Mock @grpc/proto-loader =====
const mockLoadSync = jest.fn().mockReturnValue('package-definition');

jest.mock('@grpc/proto-loader', () => ({
  loadSync: mockLoadSync,
}));

import { PlaybookGrpcService } from './playbook-grpc.service';

describe('PlaybookGrpcService', () => {
  let service: PlaybookGrpcService;
  let loggerService: jest.Mocked<LoggerService>;
  let configService: jest.Mocked<ConfigService>;

  const defaultConfig: Record<string, any> = {
    'playbook.grpcUrl': 'localhost:50051',
    'playbook.grpcTimeoutMs': 300000,
    'playbook.grpcWorkflowTimeoutMs': 600000,
  };

  const createService = async (configOverrides: Record<string, any> = {}) => {
    const config = { ...defaultConfig, ...configOverrides };

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => config[key] ?? defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookGrpcService,
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    return {
      service: module.get<PlaybookGrpcService>(PlaybookGrpcService),
      loggerService: module.get(LoggerService) as jest.Mocked<LoggerService>,
      configService: module.get(ConfigService) as jest.Mocked<ConfigService>,
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default: waitForReady succeeds
    mockWaitForReady.mockImplementation((_deadline: Date, cb: (err: Error | null) => void) => {
      cb(null);
    });

    // Default: watchConnectivityState does nothing (no callback invoked)
    mockWatchConnectivityState.mockImplementation(() => {});
    mockGetConnectivityState.mockReturnValue(2); // READY

    const result = await createService();
    service = result.service;
    loggerService = result.loggerService;
    configService = result.configService;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ===== Constructor =====

  describe('constructor', () => {
    it('should set logger context to PlaybookGrpcService', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('PlaybookGrpcService');
    });

    it('should read grpcUrl from config', () => {
      expect(configService.get).toHaveBeenCalledWith('playbook.grpcUrl', 'localhost:50051');
    });

    it('should read grpcTimeoutMs from config', () => {
      expect(configService.get).toHaveBeenCalledWith('playbook.grpcTimeoutMs', 300000);
    });

    it('should read grpcWorkflowTimeoutMs from config', () => {
      expect(configService.get).toHaveBeenCalledWith('playbook.grpcWorkflowTimeoutMs', 600000);
    });

    it('should use custom config values when provided', async () => {
      const { configService: cs } = await createService({
        'playbook.grpcUrl': 'custom-host:9090',
        'playbook.grpcTimeoutMs': 60000,
        'playbook.grpcWorkflowTimeoutMs': 120000,
      });

      expect(cs.get).toHaveBeenCalledWith('playbook.grpcUrl', 'localhost:50051');
      expect(cs.get).toHaveBeenCalledWith('playbook.grpcTimeoutMs', 300000);
      expect(cs.get).toHaveBeenCalledWith('playbook.grpcWorkflowTimeoutMs', 600000);
    });
  });

  // ===== onModuleInit =====

  describe('onModuleInit', () => {
    it('should load proto file and create gRPC client', () => {
      service.onModuleInit();

      expect(mockLoadSync).toHaveBeenCalledWith(
        expect.stringContaining('chatbot.proto'),
        expect.objectContaining({
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        }),
      );
      expect(mockLoadPackageDefinition).toHaveBeenCalledWith('package-definition');
      expect(MockChatbotServiceConstructor).toHaveBeenCalledWith(
        'localhost:50051',
        'insecure-credentials',
      );
    });

    it('should set isAvailable to true when waitForReady succeeds', () => {
      mockWaitForReady.mockImplementation((_deadline: Date, cb: (err: Error | null) => void) => {
        cb(null);
      });

      service.onModuleInit();

      expect(service.isAvailable).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith('Playbook gRPC client connected');
    });

    it('should set isAvailable to false when waitForReady fails', () => {
      mockWaitForReady.mockImplementation((_deadline: Date, cb: (err: Error | null) => void) => {
        cb(new Error('Connection refused'));
      });

      service.onModuleInit();

      expect(service.isAvailable).toBe(false);
      expect(loggerService.warn).toHaveBeenCalledWith('Playbook gRPC not ready at startup', {
        error: 'Connection refused',
      });
    });

    it('should log error and not throw when proto loading fails', () => {
      mockLoadSync.mockImplementationOnce(() => {
        throw new Error('Proto file not found');
      });

      expect(() => service.onModuleInit()).not.toThrow();

      expect(loggerService.error).toHaveBeenCalledWith('Failed to init playbook gRPC client', {
        error: 'Proto file not found',
      });
    });

    it('should call watchChannelState after successful init', () => {
      service.onModuleInit();

      expect(mockGetChannel).toHaveBeenCalled();
      expect(mockGetConnectivityState).toHaveBeenCalledWith(false);
      expect(mockWatchConnectivityState).toHaveBeenCalled();
    });

    it('should use custom grpcUrl from config', async () => {
      const { service: customService } = await createService({
        'playbook.grpcUrl': 'ai-service:9090',
      });

      customService.onModuleInit();

      expect(MockChatbotServiceConstructor).toHaveBeenCalledWith(
        'ai-service:9090',
        'insecure-credentials',
      );
    });
  });

  // ===== isAvailable getter =====

  describe('isAvailable', () => {
    it('should return false before onModuleInit is called', async () => {
      // Create service without calling onModuleInit
      const { service: freshService } = await createService();

      expect(freshService.isAvailable).toBe(false);
    });

    it('should return true after successful initialization', () => {
      mockWaitForReady.mockImplementation((_d: Date, cb: (err: Error | null) => void) => cb(null));
      service.onModuleInit();

      expect(service.isAvailable).toBe(true);
    });
  });

  // ===== workflowTimeoutMs getter =====

  describe('workflowTimeoutMs', () => {
    it('should return default workflow timeout', () => {
      expect(service.workflowTimeoutMs).toBe(600000);
    });

    it('should return configured workflow timeout', async () => {
      const { service: customService } = await createService({
        'playbook.grpcWorkflowTimeoutMs': 900000,
      });

      expect(customService.workflowTimeoutMs).toBe(900000);
    });
  });

  // ===== runStep =====

  describe('runStep', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should resolve with response on successful gRPC call', async () => {
      const mockResponse = { result: 'success', output: 'hello' };
      mockRunStep.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(null, mockResponse);
      });

      const request = { task: { id: 'task-1' }, playbook_id: 'pb-1' };
      const result = await service.runStep(request);

      expect(result).toEqual(mockResponse);
      expect(mockRunStep).toHaveBeenCalledWith(
        request,
        { deadline: expect.any(Date) },
        expect.any(Function),
      );
    });

    it('should reject on gRPC error', async () => {
      const grpcError = new Error('UNAVAILABLE: service not available');
      mockRunStep.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(grpcError, null);
      });

      const request = { task: { id: 'task-2' }, playbook_id: 'pb-1' };

      await expect(service.runStep(request)).rejects.toThrow('UNAVAILABLE: service not available');
      expect(loggerService.error).toHaveBeenCalledWith('gRPC RunStep call error', {
        taskId: 'task-2',
        error: 'UNAVAILABLE: service not available',
      });
    });

    it('should set deadline based on configured timeout', async () => {
      const beforeCall = Date.now();
      mockRunStep.mockImplementation((_req: any, opts: any, cb: Function) => {
        const deadline = opts.deadline as Date;
        // deadline should be approximately now + 300000ms
        expect(deadline.getTime()).toBeGreaterThanOrEqual(beforeCall + 300000 - 100);
        expect(deadline.getTime()).toBeLessThanOrEqual(beforeCall + 300000 + 1000);
        cb(null, {});
      });

      await service.runStep({ task: { id: 't' }, playbook_id: 'p' });

      expect(mockRunStep).toHaveBeenCalled();
    });

    it('should log call details when initiated', async () => {
      mockRunStep.mockImplementation((_req: any, _opts: any, cb: Function) => cb(null, {}));

      await service.runStep({ task: { id: 'task-x' }, playbook_id: 'pb-x' });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC RunStep call initiated', {
        taskId: 'task-x',
        playbookId: 'pb-x',
        timeoutMs: 300000,
      });
    });

    it('should handle request with no task gracefully', async () => {
      mockRunStep.mockImplementation((_req: any, _opts: any, cb: Function) => cb(null, {}));

      await service.runStep({ playbook_id: 'pb-1' });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC RunStep call initiated', {
        taskId: undefined,
        playbookId: 'pb-1',
        timeoutMs: 300000,
      });
    });

    it('should use custom timeout from config', async () => {
      const { service: customService } = await createService({
        'playbook.grpcTimeoutMs': 60000,
      });
      customService.onModuleInit();

      const beforeCall = Date.now();
      mockRunStep.mockImplementation((_req: any, opts: any, cb: Function) => {
        const deadline = opts.deadline as Date;
        expect(deadline.getTime()).toBeGreaterThanOrEqual(beforeCall + 60000 - 100);
        expect(deadline.getTime()).toBeLessThanOrEqual(beforeCall + 60000 + 1000);
        cb(null, {});
      });

      await customService.runStep({ task: { id: 't' }, playbook_id: 'p' });
    });
  });

  // ===== runPlaybookWorkflow =====

  describe('runPlaybookWorkflow', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should return a readable stream from gRPC', () => {
      const mockStream = { on: jest.fn(), cancel: jest.fn() };
      mockRunPlaybookWorkflow.mockReturnValue(mockStream);

      const request = {
        playbook_id: 'pb-1',
        tasks: [{ id: 't1' }, { id: 't2' }],
        agents: [{ id: 'a1' }],
      };
      const result = service.runPlaybookWorkflow(request);

      expect(result).toBe(mockStream);
      expect(mockRunPlaybookWorkflow).toHaveBeenCalledWith(request);
    });

    it('should log stream initiation with playbook details', () => {
      mockRunPlaybookWorkflow.mockReturnValue({ on: jest.fn() });

      service.runPlaybookWorkflow({
        playbook_id: 'pb-42',
        tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        agents: [{ id: 'a1' }, { id: 'a2' }],
      });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC RunPlaybookWorkflow stream initiated', {
        playbookId: 'pb-42',
        taskCount: 3,
        agentCount: 2,
      });
    });

    it('should handle request with no tasks or agents', () => {
      mockRunPlaybookWorkflow.mockReturnValue({ on: jest.fn() });

      service.runPlaybookWorkflow({ playbook_id: 'pb-1' });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC RunPlaybookWorkflow stream initiated', {
        playbookId: 'pb-1',
        taskCount: undefined,
        agentCount: undefined,
      });
    });
  });

  // ===== resumePlaybookWorkflow =====

  describe('resumePlaybookWorkflow', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should return a readable stream from gRPC', () => {
      const mockStream = { on: jest.fn(), cancel: jest.fn() };
      mockResumePlaybookWorkflow.mockReturnValue(mockStream);

      const request = {
        playbook_id: 'pb-1',
        thread_id: 'thread-abc',
        task_id: 'task-1',
      };
      const result = service.resumePlaybookWorkflow(request);

      expect(result).toBe(mockStream);
      expect(mockResumePlaybookWorkflow).toHaveBeenCalledWith(request);
    });

    it('should log stream initiation with request details', () => {
      mockResumePlaybookWorkflow.mockReturnValue({ on: jest.fn() });

      service.resumePlaybookWorkflow({
        playbook_id: 'pb-5',
        thread_id: 'thread-xyz',
        task_id: 'task-7',
      });

      expect(loggerService.log).toHaveBeenCalledWith(
        'gRPC ResumePlaybookWorkflow stream initiated',
        {
          playbookId: 'pb-5',
          threadId: 'thread-xyz',
          taskId: 'task-7',
        },
      );
    });
  });

  // ===== resumeStep =====

  describe('resumeStep', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should resolve with response on success', async () => {
      const mockResponse = { status: 'resumed' };
      mockResumeStep.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(null, mockResponse);
      });

      const request = { playbook_id: 'pb-1', thread_id: 'th-1', task_id: 'task-1' };
      const result = await service.resumeStep(request);

      expect(result).toEqual(mockResponse);
      expect(mockResumeStep).toHaveBeenCalledWith(
        request,
        { deadline: expect.any(Date) },
        expect.any(Function),
      );
    });

    it('should reject on gRPC error', async () => {
      const grpcError = new Error('DEADLINE_EXCEEDED');
      mockResumeStep.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(grpcError, null);
      });

      const request = { playbook_id: 'pb-1', thread_id: 'th-1', task_id: 'task-err' };

      await expect(service.resumeStep(request)).rejects.toThrow('DEADLINE_EXCEEDED');
      expect(loggerService.error).toHaveBeenCalledWith('gRPC ResumeStep call error', {
        taskId: 'task-err',
        error: 'DEADLINE_EXCEEDED',
      });
    });

    it('should log call details when initiated', async () => {
      mockResumeStep.mockImplementation((_req: any, _opts: any, cb: Function) => cb(null, {}));

      await service.resumeStep({
        playbook_id: 'pb-r',
        thread_id: 'th-r',
        task_id: 'task-r',
      });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC ResumeStep call initiated', {
        playbookId: 'pb-r',
        threadId: 'th-r',
        taskId: 'task-r',
        timeoutMs: 300000,
      });
    });

    it('should set deadline based on configured timeout', async () => {
      const beforeCall = Date.now();
      mockResumeStep.mockImplementation((_req: any, opts: any, cb: Function) => {
        const deadline = opts.deadline as Date;
        expect(deadline.getTime()).toBeGreaterThanOrEqual(beforeCall + 300000 - 100);
        expect(deadline.getTime()).toBeLessThanOrEqual(beforeCall + 300000 + 1000);
        cb(null, {});
      });

      await service.resumeStep({ playbook_id: 'p', thread_id: 't', task_id: 'tk' });
    });
  });

  // ===== stopPlaybookWorkflow =====

  describe('stopPlaybookWorkflow', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should resolve with response on success', async () => {
      const mockResponse = { stopped: true };
      mockStopPlaybookWorkflow.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(null, mockResponse);
      });

      const request = { playbook_id: 'pb-stop' };
      const result = await service.stopPlaybookWorkflow(request);

      expect(result).toEqual(mockResponse);
    });

    it('should reject on gRPC error', async () => {
      const grpcError = new Error('INTERNAL: stop failed');
      mockStopPlaybookWorkflow.mockImplementation((_req: any, _opts: any, cb: Function) => {
        cb(grpcError, null);
      });

      await expect(service.stopPlaybookWorkflow({ playbook_id: 'pb-stop' })).rejects.toThrow(
        'INTERNAL: stop failed',
      );
      expect(loggerService.error).toHaveBeenCalledWith('gRPC StopPlaybookWorkflow call error', {
        error: 'INTERNAL: stop failed',
      });
    });

    it('should use a 10-second deadline (not the configured timeout)', async () => {
      const beforeCall = Date.now();
      mockStopPlaybookWorkflow.mockImplementation((_req: any, opts: any, cb: Function) => {
        const deadline = opts.deadline as Date;
        // stopPlaybookWorkflow uses a hardcoded 10000ms deadline
        expect(deadline.getTime()).toBeGreaterThanOrEqual(beforeCall + 10000 - 100);
        expect(deadline.getTime()).toBeLessThanOrEqual(beforeCall + 10000 + 1000);
        cb(null, {});
      });

      await service.stopPlaybookWorkflow({ playbook_id: 'pb-1' });
    });

    it('should log call details when initiated', async () => {
      mockStopPlaybookWorkflow.mockImplementation((_req: any, _opts: any, cb: Function) =>
        cb(null, {}),
      );

      await service.stopPlaybookWorkflow({ playbook_id: 'pb-log' });

      expect(loggerService.log).toHaveBeenCalledWith('gRPC StopPlaybookWorkflow call initiated', {
        playbookId: 'pb-log',
      });
    });
  });

  // ===== generatePlaybook =====

  describe('generatePlaybook', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should resolve with response on success', async () => {
      const mockResponse = { playbook: { id: 'new-pb', tasks: [] } };
      mockGeneratePlaybook.mockImplementation((_req: any, cb: Function) => {
        cb(null, mockResponse);
      });

      const request = { prompt: 'Create a playbook for onboarding' };
      const result = await service.generatePlaybook(request);

      expect(result).toEqual(mockResponse);
      expect(mockGeneratePlaybook).toHaveBeenCalledWith(request, expect.any(Function));
    });

    it('should reject on gRPC error', async () => {
      const grpcError = new Error('UNIMPLEMENTED');
      mockGeneratePlaybook.mockImplementation((_req: any, cb: Function) => {
        cb(grpcError, null);
      });

      await expect(
        service.generatePlaybook({ prompt: 'fail' }),
      ).rejects.toThrow('UNIMPLEMENTED');
    });

    it('should not set a deadline (no deadline in the call)', async () => {
      mockGeneratePlaybook.mockImplementation((_req: any, cb: Function) => {
        cb(null, {});
      });

      await service.generatePlaybook({ prompt: 'test' });

      // generatePlaybook is called with (request, callback) - no options/deadline
      expect(mockGeneratePlaybook).toHaveBeenCalledWith(
        { prompt: 'test' },
        expect.any(Function),
      );
      // Ensure it was called with exactly 2 args (no deadline options)
      expect(mockGeneratePlaybook.mock.calls[0]).toHaveLength(2);
    });
  });

  // ===== Stream Management =====

  describe('stream management', () => {
    const mockStream = { on: jest.fn(), cancel: jest.fn() } as any;

    describe('registerStream', () => {
      it('should store a stream by executionId', () => {
        service.registerStream('exec-1', mockStream);

        expect(service.getStream('exec-1')).toBe(mockStream);
      });

      it('should overwrite an existing stream for the same executionId', () => {
        const firstStream = { on: jest.fn(), cancel: jest.fn() } as any;
        const secondStream = { on: jest.fn(), cancel: jest.fn() } as any;

        service.registerStream('exec-1', firstStream);
        service.registerStream('exec-1', secondStream);

        expect(service.getStream('exec-1')).toBe(secondStream);
      });
    });

    describe('getStream', () => {
      it('should return the stream for a registered executionId', () => {
        service.registerStream('exec-2', mockStream);

        expect(service.getStream('exec-2')).toBe(mockStream);
      });

      it('should return undefined for an unregistered executionId', () => {
        expect(service.getStream('nonexistent')).toBeUndefined();
      });
    });

    describe('removeStream', () => {
      it('should remove a registered stream', () => {
        service.registerStream('exec-3', mockStream);
        service.removeStream('exec-3');

        expect(service.getStream('exec-3')).toBeUndefined();
      });

      it('should not throw when removing a non-existent stream', () => {
        expect(() => service.removeStream('nonexistent')).not.toThrow();
      });
    });

    describe('markCancelled', () => {
      it('should flag an execution as cancelled', () => {
        service.markCancelled('exec-cancel-1');

        expect(service.wasCancelled('exec-cancel-1')).toBe(true);
      });
    });

    describe('wasCancelled', () => {
      it('should return true for a cancelled execution', () => {
        service.markCancelled('exec-c');

        expect(service.wasCancelled('exec-c')).toBe(true);
      });

      it('should return false for an execution that was not cancelled', () => {
        expect(service.wasCancelled('exec-not-cancelled')).toBe(false);
      });

      it('should clean up the flag after checking (returns false on second call)', () => {
        service.markCancelled('exec-once');

        expect(service.wasCancelled('exec-once')).toBe(true);
        expect(service.wasCancelled('exec-once')).toBe(false);
      });

      it('should only clean up the checked executionId, not others', () => {
        service.markCancelled('exec-a');
        service.markCancelled('exec-b');

        service.wasCancelled('exec-a');

        expect(service.wasCancelled('exec-a')).toBe(false);
        expect(service.wasCancelled('exec-b')).toBe(true);
      });
    });
  });

  // ===== onModuleDestroy =====

  describe('onModuleDestroy', () => {
    it('should cancel all active streams', () => {
      service.onModuleInit();

      const stream1 = { on: jest.fn(), cancel: jest.fn() } as any;
      const stream2 = { on: jest.fn(), cancel: jest.fn() } as any;

      service.registerStream('exec-1', stream1);
      service.registerStream('exec-2', stream2);

      service.onModuleDestroy();

      expect(stream1.cancel).toHaveBeenCalled();
      expect(stream2.cancel).toHaveBeenCalled();
    });

    it('should clear active streams map after cancellation', () => {
      service.onModuleInit();

      const stream = { on: jest.fn(), cancel: jest.fn() } as any;
      service.registerStream('exec-1', stream);

      service.onModuleDestroy();

      expect(service.getStream('exec-1')).toBeUndefined();
    });

    it('should close the gRPC client channel', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      expect(mockCloseClient).toHaveBeenCalled();
    });

    it('should not throw if no client was initialized', async () => {
      // Create a service that fails to init the gRPC client
      mockLoadSync.mockImplementationOnce(() => {
        throw new Error('Proto not found');
      });

      const { service: failedService } = await createService();
      failedService.onModuleInit();

      expect(() => failedService.onModuleDestroy()).not.toThrow();
      // closeClient should not be called since client was never created
    });

    it('should log each cancelled stream with its executionId', () => {
      service.onModuleInit();

      const stream = { on: jest.fn(), cancel: jest.fn() } as any;
      service.registerStream('exec-logged', stream);

      service.onModuleDestroy();

      expect(loggerService.log).toHaveBeenCalledWith('Cancelling active stream on shutdown', {
        executionId: 'exec-logged',
      });
    });

    it('should handle empty active streams gracefully', () => {
      service.onModuleInit();

      expect(() => service.onModuleDestroy()).not.toThrow();
      expect(mockCloseClient).toHaveBeenCalled();
    });
  });

  // ===== watchChannelState =====

  describe('watchChannelState', () => {
    it('should update isAvailable to true when channel transitions to READY', () => {
      // Start with waitForReady failing so isAvailable is false
      mockWaitForReady.mockImplementation((_d: Date, cb: (err: Error | null) => void) => {
        cb(new Error('not ready'));
      });

      let watchCallback: () => void;
      mockWatchConnectivityState.mockImplementation(
        (_state: number, _deadline: number, cb: () => void) => {
          watchCallback = cb;
        },
      );

      service.onModuleInit();
      expect(service.isAvailable).toBe(false);

      // Simulate channel transitioning to READY
      mockGetConnectivityState.mockReturnValue(2); // READY
      watchCallback!();

      expect(service.isAvailable).toBe(true);
      expect(loggerService.log).toHaveBeenCalledWith('Playbook gRPC connection restored', {
        state: 2,
      });
    });

    it('should update isAvailable to true when channel transitions to IDLE', () => {
      mockWaitForReady.mockImplementation((_d: Date, cb: (err: Error | null) => void) => {
        cb(new Error('not ready'));
      });

      let watchCallback: () => void;
      mockWatchConnectivityState.mockImplementation(
        (_state: number, _deadline: number, cb: () => void) => {
          watchCallback = cb;
        },
      );

      service.onModuleInit();
      expect(service.isAvailable).toBe(false);

      // Simulate channel transitioning to IDLE
      mockGetConnectivityState.mockReturnValue(0); // IDLE
      watchCallback!();

      expect(service.isAvailable).toBe(true);
    });

    it('should set isAvailable to false when channel transitions to TRANSIENT_FAILURE', () => {
      // Start available
      mockWaitForReady.mockImplementation((_d: Date, cb: (err: Error | null) => void) => {
        cb(null);
      });

      let watchCallback: () => void;
      mockWatchConnectivityState.mockImplementation(
        (_state: number, _deadline: number, cb: () => void) => {
          watchCallback = cb;
        },
      );

      service.onModuleInit();
      expect(service.isAvailable).toBe(true);

      // Simulate channel transitioning to TRANSIENT_FAILURE
      mockGetConnectivityState.mockReturnValue(3); // TRANSIENT_FAILURE
      watchCallback!();

      expect(service.isAvailable).toBe(false);
      expect(loggerService.warn).toHaveBeenCalledWith('Playbook gRPC connection lost', {
        state: 3,
      });
    });

    it('should set isAvailable to false when channel transitions to SHUTDOWN', () => {
      mockWaitForReady.mockImplementation((_d: Date, cb: (err: Error | null) => void) => {
        cb(null);
      });

      let watchCallback: () => void;
      mockWatchConnectivityState.mockImplementation(
        (_state: number, _deadline: number, cb: () => void) => {
          watchCallback = cb;
        },
      );

      service.onModuleInit();
      expect(service.isAvailable).toBe(true);

      mockGetConnectivityState.mockReturnValue(4); // SHUTDOWN
      watchCallback!();

      expect(service.isAvailable).toBe(false);
    });

    it('should retry with exponential backoff when getChannel throws', () => {
      // First call to watchChannelState succeeds from onModuleInit
      // We need getChannel to throw on the second call (recursive from watchCallback)
      let callCount = 0;
      const inlineWatchConnectivityState = jest.fn(
        (_state: number, _deadline: number, cb: () => void) => {
          // Trigger the callback which will call watchChannelState again
          // (and this time getChannel will throw)
          cb();
        },
      );
      mockGetChannel.mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Channel error');
        }
        return {
          getConnectivityState: mockGetConnectivityState,
          watchConnectivityState: inlineWatchConnectivityState,
        };
      });

      service.onModuleInit();

      // After the error, a setTimeout should have been scheduled
      // The first retry delay should be 5000ms (5000 * 2^0)
      jest.advanceTimersByTime(5000);

      // It should have retried (callCount incremented again)
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('should give up after MAX_CHANNEL_RETRIES', () => {
      // Make getChannel always throw
      mockGetChannel.mockImplementation(() => {
        throw new Error('Channel permanently broken');
      });

      service.onModuleInit();

      // Advance through all retries (up to 10)
      // Delays: 5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(60000);
      }

      expect(loggerService.error).toHaveBeenCalledWith(
        'Playbook gRPC channel watch exceeded max retries, giving up',
      );
    });
  });
});
