import { Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';
import { RequestContextService } from '../request-context.service';
import { RequestContext } from '../interfaces/request-context.interface';

// Stub crypto.randomUUID to control generated IDs
jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue('generated-uuid-123');

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockContextService: jest.Mocked<RequestContextService>;

  const createMockRequest = (
    headers: Record<string, string> = {},
    overrides: { path?: string; method?: string } = {},
  ): Partial<Request> => ({
    headers: { ...headers },
    path: overrides.path || '/api/v1/test',
    method: overrides.method || 'GET',
  });

  const createMockResponse = (): Partial<Response> => ({
    setHeader: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockContextService = {
      run: jest.fn((context: RequestContext, callback: () => void) => {
        callback();
      }),
    } as unknown as jest.Mocked<RequestContextService>;

    middleware = new RequestIdMiddleware(mockContextService);
  });

  describe('request ID extraction', () => {
    it('should generate a UUID when no request ID header is present', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'generated-uuid-123' }),
        expect.any(Function),
      );
    });

    it('should extract request ID from x-request-id header', () => {
      const req = createMockRequest({ 'x-request-id': 'custom-req-id' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'custom-req-id' }),
        expect.any(Function),
      );
    });

    it('should extract request ID from request-id header', () => {
      const req = createMockRequest({ 'request-id': 'alt-req-id' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'alt-req-id' }),
        expect.any(Function),
      );
    });

    it('should extract request ID from x-amzn-trace-id header', () => {
      const req = createMockRequest({ 'x-amzn-trace-id': 'amzn-trace-abc' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'amzn-trace-abc' }),
        expect.any(Function),
      );
    });

    it('should use the first element when header is an array', () => {
      const req = createMockRequest();
      (req.headers as Record<string, string | string[]>)['x-request-id'] = ['first-id', 'second-id'];
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'first-id' }),
        expect.any(Function),
      );
    });
  });

  describe('correlation ID extraction', () => {
    it('should set correlationId to undefined when no header is present', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: undefined }),
        expect.any(Function),
      );
    });

    it('should extract correlation ID from x-correlation-id header', () => {
      const req = createMockRequest({ 'x-correlation-id': 'corr-123' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-123' }),
        expect.any(Function),
      );
    });

    it('should extract correlation ID from correlation-id header', () => {
      const req = createMockRequest({ 'correlation-id': 'corr-456' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-456' }),
        expect.any(Function),
      );
    });

    it('should use the first element when correlation header is an array', () => {
      const req = createMockRequest();
      (req.headers as Record<string, string | string[]>)['x-correlation-id'] = ['first-corr', 'second-corr'];
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'first-corr' }),
        expect.any(Function),
      );
    });
  });

  describe('context creation', () => {
    it('should build a full RequestContext with path and method', () => {
      const req = createMockRequest(
        { 'x-request-id': 'ctx-req' },
        { path: '/api/v1/users', method: 'POST' },
      );
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'ctx-req',
          path: '/api/v1/users',
          method: 'POST',
          startTime: expect.any(Number),
        }),
        expect.any(Function),
      );
    });

    it('should attach context to req.context', () => {
      const req = createMockRequest({ 'x-request-id': 'attach-test' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(req.context).toBeDefined();
      expect(req.context?.requestId).toBe('attach-test');
      expect(req.context?.path).toBe('/api/v1/test');
      expect(req.context?.method).toBe('GET');
    });

    it('should set startTime close to now', () => {
      const before = Date.now();
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      const after = Date.now();
      expect(req.context?.startTime).toBeGreaterThanOrEqual(before);
      expect(req.context?.startTime).toBeLessThanOrEqual(after);
    });
  });

  describe('response headers', () => {
    it('should set X-Request-ID header on response', () => {
      const req = createMockRequest({ 'x-request-id': 'resp-header-id' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'resp-header-id');
    });

    it('should set X-Correlation-ID header when correlation ID is present', () => {
      const req = createMockRequest({ 'x-correlation-id': 'corr-header' });
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'corr-header');
    });

    it('should not set X-Correlation-ID header when no correlation ID', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(res.setHeader).not.toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.anything(),
      );
    });

    it('should set generated UUID as X-Request-ID when no header provided', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'generated-uuid-123');
    });
  });

  describe('next() invocation', () => {
    it('should call next inside requestContextService.run', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should call next within the context run callback', () => {
      const callOrder: string[] = [];

      mockContextService.run = jest.fn((context: RequestContext, callback: () => void) => {
        callOrder.push('run-start');
        callback();
        callOrder.push('run-end');
      }) as unknown as typeof mockContextService.run;

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn(() => callOrder.push('next'));

      middleware.use(req as Request, res as Response, next);

      expect(callOrder).toEqual(['run-start', 'next', 'run-end']);
    });
  });

  describe('trace id extraction (plan P05)', () => {
    const next = jest.fn();

    it('reuses the trace id of a valid inbound W3C traceparent', () => {
      const req = createMockRequest({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });
      const res = createMockResponse();

      middleware.use(req as Request, res as Response, next);

      expect(mockContextService.run).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }),
        expect.any(Function),
      );
    });

    it('generates a 32-hex trace id when the header is missing or malformed', () => {
      const cases: Array<Record<string, string>> = [{}, { traceparent: 'not-a-traceparent' }];
      for (const headers of cases) {
        const req = createMockRequest(headers);
        const res = createMockResponse();

        middleware.use(req as Request, res as Response, next);

        const { traceId } = mockContextService.run.mock.calls.at(-1)![0] as RequestContext;
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      }
    });
  });
});
