import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<unknown>;

  const mockRequest = {
    url: '/api/v1/test',
    context: { requestId: 'req-123' },
  };

  const createMockExecutionContext = (request = mockRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const createMockCallHandler = (data: unknown): CallHandler => ({
    handle: () => of(data),
  });

  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  };

  beforeEach(() => {
    interceptor = new ResponseInterceptor(mockReflector as any);
  });

  describe('successful responses', () => {
    it('should wrap response data in standard format', (done) => {
      const data = { id: '1', name: 'test' };
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(data);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual(data);
        expect(result.meta).toBeDefined();
        done();
      });
    });

    it('should include timestamp in meta', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler({ foo: 'bar' });

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.timestamp).toBeDefined();
        // Verify it's a valid ISO string
        expect(new Date(result.meta.timestamp).toISOString()).toBe(result.meta.timestamp);
        done();
      });
    });

    it('should include request path in meta', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(null);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.path).toBe('/api/v1/test');
        done();
      });
    });

    it('should include requestId from request context', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(null);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.requestId).toBe('req-123');
        done();
      });
    });

    it('should include duration in meta', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler('data');

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(typeof result.meta.duration).toBe('number');
        expect(result.meta.duration).toBeGreaterThanOrEqual(0);
        done();
      });
    });

    it('should handle null data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(null);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
        done();
      });
    });

    it('should handle undefined data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(undefined);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toBeUndefined();
        done();
      });
    });

    it('should handle array data', (done) => {
      const data = [{ id: '1' }, { id: '2' }];
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(data);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual(data);
        expect(result.data).toHaveLength(2);
        done();
      });
    });

    it('should handle string data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler('plain string');

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toBe('plain string');
        done();
      });
    });

    it('should handle numeric data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(42);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toBe(42);
        done();
      });
    });

    it('should handle boolean data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(true);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toBe(true);
        done();
      });
    });

    it('should handle empty object data', (done) => {
      const context = createMockExecutionContext();
      const handler = createMockCallHandler({});

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual({});
        done();
      });
    });

    it('should handle nested object data', (done) => {
      const data = { user: { name: 'John', address: { city: 'NYC' } } };
      const context = createMockExecutionContext();
      const handler = createMockCallHandler(data);

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual(data);
        done();
      });
    });
  });

  describe('request context handling', () => {
    it('should handle missing request context gracefully', (done) => {
      const request = { url: '/api/v1/no-context' };
      const context = createMockExecutionContext(request as typeof mockRequest);
      const handler = createMockCallHandler('data');

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.requestId).toBeUndefined();
        expect(result.meta.path).toBe('/api/v1/no-context');
        done();
      });
    });

    it('should handle undefined requestId in context', (done) => {
      const request = { url: '/test', context: {} };
      const context = createMockExecutionContext(request as typeof mockRequest);
      const handler = createMockCallHandler('data');

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.requestId).toBeUndefined();
        done();
      });
    });

    it('should preserve different request paths', (done) => {
      const request = {
        url: '/api/v1/users/123/profile?include=avatar',
        context: { requestId: 'req-456' },
      };
      const context = createMockExecutionContext(request);
      const handler = createMockCallHandler({ id: '123' });

      interceptor.intercept(context, handler).subscribe((result) => {
        expect(result.meta.path).toBe('/api/v1/users/123/profile?include=avatar');
        expect(result.meta.requestId).toBe('req-456');
        done();
      });
    });
  });

  describe('error passthrough', () => {
    it('should not catch errors from the handler', (done) => {
      const error = new Error('Something went wrong');
      const context = createMockExecutionContext();
      const handler: CallHandler = { handle: () => throwError(() => error) };

      interceptor.intercept(context, handler).subscribe({
        next: () => done.fail('Should not emit a value'),
        error: (err) => {
          expect(err).toBe(error);
          done();
        },
      });
    });
  });
});
