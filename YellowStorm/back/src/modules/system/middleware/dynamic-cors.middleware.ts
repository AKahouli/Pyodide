import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SystemService } from '../system.service';

@Injectable()
export class DynamicCorsMiddleware implements NestMiddleware {
  constructor(private readonly systemService: SystemService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;
    const requestOrigin = origin || (referer ? new URL(referer).origin : undefined);

    if (!requestOrigin) {
      return next();
    }

    const enabledOrigins = this.systemService.getEnabledCorsOrigins();
    if (enabledOrigins.length === 0) {
      return next();
    }

    if (enabledOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,Accept,Origin,X-Requested-With,X-Correlation-ID,X-Request-ID,Idempotency-Key,Cache-Control,Connection',
      );
      res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
    }

    if (req.method === 'OPTIONS') {
      if (enabledOrigins.includes(requestOrigin)) {
        res.status(204).end();
        return;
      }
      return next();
    }

    next();
  }
}
