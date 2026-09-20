import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/exceptions/base.exception';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { AiProxyErrorBody } from './interfaces/ai-proxy.interface';

@Catch()
export class AiProxyExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isUsageLimit = exception instanceof AppException
      && exception.code === ErrorCode.USAGE_LIMIT_EXCEEDED;
    const isAccessDenied = exception instanceof AppException
      && (
        exception.code === ErrorCode.APP_BUILDER_AI_DISABLED
        || exception.code === ErrorCode.APP_DATA_GRANT_DENIED
        || exception.code === ErrorCode.APP_DATA_USER_DISABLED
      );

    if (isUsageLimit) {
      status = HttpStatus.TOO_MANY_REQUESTS;
    }
    if (isAccessDenied) {
      status = HttpStatus.FORBIDDEN;
    }

    const message = this.getMessage(exception);
    const body: AiProxyErrorBody = {
      error: {
        message,
        type: this.getErrorType(status, isUsageLimit, isAccessDenied),
        ...(isUsageLimit ? { code: 'insufficient_quota' } : {}),
        ...(isAccessDenied ? { code: 'access_denied' } : {}),
      },
    };

    response.status(status).json(body);
  }

  private getMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') return exceptionResponse;
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const message = (exceptionResponse as { message?: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return String(message[0] ?? 'Invalid request');
      }
    }

    if (exception instanceof Error) return exception.message;
    return 'AI proxy request failed';
  }

  private getErrorType(
    status: number,
    isUsageLimit: boolean,
    isAccessDenied: boolean,
  ): string {
    if (isUsageLimit) return 'insufficient_quota';
    if (isAccessDenied) return 'access_denied';
    if (status >= 400 && status < 500) {
      return status === HttpStatus.TOO_MANY_REQUESTS
        ? 'rate_limit_error'
        : 'invalid_request_error';
    }
    return 'server_error';
  }
}
