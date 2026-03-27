import { RequestContextService } from './request-context.service';
import { RequestContext } from './interfaces/request-context.interface';

describe('RequestContextService', () => {
  let service: RequestContextService;

  const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
    requestId: 'req-123',
    startTime: Date.now(),
    path: '/test',
    method: 'GET',
    ...overrides,
  });

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should execute callback within context', () => {
      const context = createContext();
      const result = service.run(context, () => 'done');

      expect(result).toBe('done');
    });

    it('should make context available inside callback', () => {
      const context = createContext({ requestId: 'abc-456' });

      service.run(context, () => {
        expect(service.getContext()).toBe(context);
      });
    });

    it('should return the callback return value', () => {
      const context = createContext();
      const result = service.run(context, () => ({ id: 1 }));

      expect(result).toEqual({ id: 1 });
    });
  });

  describe('getContext', () => {
    it('should return undefined outside of a run', () => {
      expect(service.getContext()).toBeUndefined();
    });

    it('should return the context inside a run', () => {
      const context = createContext();

      service.run(context, () => {
        expect(service.getContext()).toBe(context);
      });
    });

    it('should isolate contexts between nested runs', () => {
      const outer = createContext({ requestId: 'outer' });
      const inner = createContext({ requestId: 'inner' });

      service.run(outer, () => {
        expect(service.getContext()?.requestId).toBe('outer');

        service.run(inner, () => {
          expect(service.getContext()?.requestId).toBe('inner');
        });

        // Outer context restored after inner run completes
        expect(service.getContext()?.requestId).toBe('outer');
      });
    });
  });

  describe('getRequestId', () => {
    it('should return undefined outside of a run', () => {
      expect(service.getRequestId()).toBeUndefined();
    });

    it('should return the requestId from context', () => {
      const context = createContext({ requestId: 'req-789' });

      service.run(context, () => {
        expect(service.getRequestId()).toBe('req-789');
      });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined outside of a run', () => {
      expect(service.getCorrelationId()).toBeUndefined();
    });

    it('should return undefined when correlationId is not set', () => {
      const context = createContext();

      service.run(context, () => {
        expect(service.getCorrelationId()).toBeUndefined();
      });
    });

    it('should return the correlationId from context', () => {
      const context = createContext({ correlationId: 'corr-abc' });

      service.run(context, () => {
        expect(service.getCorrelationId()).toBe('corr-abc');
      });
    });
  });

  describe('getUserId', () => {
    it('should return undefined outside of a run', () => {
      expect(service.getUserId()).toBeUndefined();
    });

    it('should return undefined when userId is not set', () => {
      const context = createContext();

      service.run(context, () => {
        expect(service.getUserId()).toBeUndefined();
      });
    });

    it('should return the userId from context', () => {
      const context = createContext({ userId: 'user-42' });

      service.run(context, () => {
        expect(service.getUserId()).toBe('user-42');
      });
    });
  });

  describe('setUserId', () => {
    it('should do nothing outside of a run', () => {
      // Should not throw
      service.setUserId('user-99');
      expect(service.getUserId()).toBeUndefined();
    });

    it('should set userId on the current context', () => {
      const context = createContext();

      service.run(context, () => {
        expect(service.getUserId()).toBeUndefined();
        service.setUserId('user-55');
        expect(service.getUserId()).toBe('user-55');
      });
    });

    it('should overwrite existing userId', () => {
      const context = createContext({ userId: 'old-user' });

      service.run(context, () => {
        service.setUserId('new-user');
        expect(service.getUserId()).toBe('new-user');
      });
    });
  });

  describe('getElapsedTime', () => {
    it('should return 0 outside of a run', () => {
      expect(service.getElapsedTime()).toBe(0);
    });

    it('should return non-negative elapsed time inside a run', () => {
      const context = createContext({ startTime: Date.now() });

      service.run(context, () => {
        const elapsed = service.getElapsedTime();
        expect(elapsed).toBeGreaterThanOrEqual(0);
      });
    });

    it('should reflect time since startTime', () => {
      const context = createContext({ startTime: Date.now() - 500 });

      service.run(context, () => {
        const elapsed = service.getElapsedTime();
        expect(elapsed).toBeGreaterThanOrEqual(490);
        expect(elapsed).toBeLessThan(1000);
      });
    });
  });

  describe('getLogOptions', () => {
    it('should return undefined requestId outside of a run', () => {
      const options = service.getLogOptions();
      expect(options.requestId).toBeUndefined();
    });

    it('should return LogOptions with requestId from context', () => {
      const context = createContext({ requestId: 'log-req-1' });

      service.run(context, () => {
        const options = service.getLogOptions();
        expect(options).toEqual({ requestId: 'log-req-1' });
      });
    });
  });

  describe('async context propagation', () => {
    it('should propagate context through async operations', async () => {
      const context = createContext({ requestId: 'async-req' });

      await new Promise<void>((resolve) => {
        service.run(context, async () => {
          // Simulate async work
          await new Promise((r) => setTimeout(r, 10));
          expect(service.getRequestId()).toBe('async-req');
          resolve();
        });
      });
    });
  });
});
