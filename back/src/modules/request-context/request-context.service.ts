import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { RequestContext } from './interfaces/request-context.interface';
import { LogOptions } from '@modules/logger';

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

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
