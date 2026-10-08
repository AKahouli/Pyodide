import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { RequestContext } from './interfaces/request-context.interface';
import { LogOptions } from '@modules/logger';
import { GrpcCorrelation, setGrpcCorrelationProvider } from '@common/grpc/grpc-security.util';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  constructor() {
    // Make every createGrpcMetadata() call carry this request's correlation
    // headers without per-call-site plumbing (plan P05).
    setGrpcCorrelationProvider(() => this.grpcCorrelation());
  }

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.getContext()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.getContext()?.correlationId;
  }

  getTraceId(): string | undefined {
    return this.getContext()?.traceId;
  }

  /** Correlation headers for outbound gRPC calls: W3C traceparent (fresh span per call) + ids. */
  grpcCorrelation(): GrpcCorrelation {
    const ctx = this.getContext();
    if (!ctx) return {};
    const traceparent = ctx.traceId
      ? `00-${ctx.traceId}-${randomBytes(8).toString('hex')}-01`
      : undefined;
    return { traceparent, requestId: ctx.requestId, correlationId: ctx.correlationId };
  }

  getUserId(): string | undefined {
    return this.getContext()?.userId;
  }

  setUserId(userId: string): void {
    const context = this.getContext();
    if (context) {
      context.userId = userId;
    }
  }

  getElapsedTime(): number {
    const context = this.getContext();
    if (!context) return 0;
    return Date.now() - context.startTime;
  }

  /**
   * Get LogOptions with the current requestId for consistent logging
   */
  getLogOptions(): LogOptions {
    return {
      requestId: this.getRequestId(),
    };
  }
}
