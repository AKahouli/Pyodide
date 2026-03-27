import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { ApiResponse, ResponseMeta } from '../interfaces/response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data: T) => {
        const meta: ResponseMeta = {
          timestamp: new Date().toISOString(),
          requestId: request.context?.requestId,
          path: request.url,
          duration: Date.now() - startTime,
        };

        return {
          success: true as const,
          data,
          meta,
        };
      }),
    );
  }
}
