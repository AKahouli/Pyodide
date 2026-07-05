
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../logger/logger.service';
import { AppException } from '../exceptions/base.exception';
import { ErrorCode, ErrorMessages } from '../constants/error-codes';
import { ErrorResponse, ErrorDetail } from '../interfaces/error-response.interface';
import { MaintenanceException } from '../../system/exceptions/maintenance.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly isProduction: boolean;

  constructor(
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(GlobalExceptionFilter.name);
    this.isProduction = this.configService.get<string>('app.nodeEnv') === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['request-id']?.toString() || request.headers['x-request-id']?.toString() || uuidv4();

    const errorResponse = this.buildErrorResponse(exception, request, requestId);

    this.logException(exception, errorResponse, requestId);

    response.status(errorResponse.error.statusCode).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
    requestId: string,
  ): ErrorResponse {
    const baseResponse = {
      success: false as const,
      error: {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        requestId,
      },
    };

    // Handle maintenance mode exception specially
    if (exception instanceof MaintenanceException) {
      return {
        ...baseResponse,
        error: {
          ...baseResponse.error,
          code: exception.code,
          message: exception.message,
          statusCode: exception.statusCode,
        },
        maintenance: exception.maintenance,
      } as ErrorResponse;
    }

    if (exception instanceof AppException) {
      return {
        ...baseResponse,
        error: {
          ...baseResponse.error,
          code: exception.code,
          message: exception.message,
          statusCode: exception.getStatus(),
          details: exception.details,
        },
      };
    }

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, baseResponse);
    }

    return this.handleUnknownException(exception, baseResponse);
  }

  private handleHttpException(
    exception: HttpException,
    baseResponse: { success: false; error: { timestamp: string; path: string; method: string; requestId: string } },
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message: string;
    let details: ErrorDetail[] | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const responseObj = exceptionResponse as Record<string, unknown>;
      message = this.extractMessage(responseObj);
      details = this.extractValidationDetails(responseObj);
    } else {
      message = 'An error occurred';
    }

    const code = this.mapStatusToErrorCode(status);

    return {
      ...baseResponse,
      error: {
        ...baseResponse.error,
        code,
        message: this.isProduction ? ErrorMessages[code] : message,
        statusCode: status,
        details,
      },
    };
  }

  private handleUnknownException(
    exception: unknown,
    baseResponse: { success: false; error: { timestamp: string; path: string; method: string; requestId: string } },
  ): ErrorResponse {
    const message = this.isProduction
      ? ErrorMessages[ErrorCode.INTERNAL_ERROR]
      : this.getUnknownExceptionMessage(exception);

    return {
      ...baseResponse,
      error: {
        ...baseResponse.error,
        code: ErrorCode.INTERNAL_ERROR,
        message,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      },
    };
  }

  private extractMessage(responseObj: Record<string, unknown>): string {
    if (typeof responseObj.message === 'string') {
      return responseObj.message;
    }
    if (Array.isArray(responseObj.message) && responseObj.message.length > 0) {
      return String(responseObj.message[0]);
    }
    return 'An error occurred';
  }

  private extractValidationDetails(responseObj: Record<string, unknown>): ErrorDetail[] | undefined {
    if (!Array.isArray(responseObj.message)) {
      return undefined;
    }

    return responseObj.message.map((msg) => ({
      message: String(msg),
    }));
  }

  private mapStatusToErrorCode(status: number): ErrorCode {
    const statusMap: Record<number, ErrorCode> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_ERROR,
      [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
    };

    return statusMap[status] || ErrorCode.INTERNAL_ERROR;
  }

  private getUnknownExceptionMessage(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.message;
    }
    if (typeof exception === 'string') {
      return exception;
    }
    return 'Unknown error occurred';
  }

  private logException(
    exception: unknown,
    errorResponse: ErrorResponse,
    requestId: string,
  ): void {
    const logData = {
      requestId,
      code: errorResponse.error.code,
      statusCode: errorResponse.error.statusCode,
      path: errorResponse.error.path,
      method: errorResponse.error.method,
    };

    if (errorResponse.error.statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(errorResponse.error.message, { ...logData, stack });
    } else if (errorResponse.error.statusCode >= 400) {
      this.logger.warn(errorResponse.error.message, logData);
    }
  }
}
