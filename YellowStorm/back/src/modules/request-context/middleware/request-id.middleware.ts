import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { RequestContextService } from '../request-context.service';
import { RequestContext } from '../interfaces/request-context.interface';

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.extractRequestId(req);
    const correlationId = this.extractCorrelationId(req);

    const context: RequestContext = {
      requestId,
      correlationId,
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
}
