import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { RequestContextService } from '../request-context.service';
import { RequestContext } from '../interfaces/request-context.interface';

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

const TRACEPATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.extractRequestId(req);
    const correlationId = this.extractCorrelationId(req);
    const traceId = this.extractTraceId(req);

    const context: RequestContext = {
      requestId,
      correlationId,
      traceId,
      startTime: Date.now(),
      path: req.path,
      method: req.method,
    };

    req.context = context;

    res.setHeader('X-Request-ID', requestId);
    if (correlationId) {
      res.setHeader('X-Correlation-ID', correlationId);
    }

    this.requestContextService.run(context, () => {
      next();
    });
  }

  private extractRequestId(req: Request): string {
    const fromHeader =
      req.headers['x-request-id'] ||
      req.headers['request-id'] ||
      req.headers['x-amzn-trace-id'];

    if (fromHeader) {
      return Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    }

    return randomUUID();
  }

  private extractCorrelationId(req: Request): string | undefined {
    const fromHeader =
      req.headers['x-correlation-id'] ||
      req.headers['correlation-id'];

    if (fromHeader) {
      return Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    }

    return undefined;
  }

  /** Root trace: reuse the inbound W3C traceparent's trace id, else start a fresh trace (plan P05). */
  private extractTraceId(req: Request): string {
    const traceparent = req.headers['traceparent'];
    const value = Array.isArray(traceparent) ? traceparent[0] : traceparent;
    if (value && TRACEPATTERN.test(value)) {
      return value.slice(3, 35).toLowerCase();
    }
    return randomBytes(16).toString('hex');
  }
}
