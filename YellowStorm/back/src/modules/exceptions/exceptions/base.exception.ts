import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorMessages } from '../constants/error-codes';
import { ErrorDetail } from '../interfaces/error-response.interface';

export interface AppExceptionOptions {
  code: ErrorCode;
  message?: string;
  statusCode?: HttpStatus;
  details?: ErrorDetail[];
  originalError?: Error;
}

export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetail[];
  public readonly originalError?: Error;

  constructor(options: AppExceptionOptions) {
    const message = options.message || ErrorMessages[options.code];
    const statusCode = options.statusCode || HttpStatus.INTERNAL_SERVER_ERROR;

    super(message, statusCode, { cause: options.originalError });

    this.code = options.code;
    this.details = options.details;
    this.originalError = options.originalError;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.getStatus(),
      details: this.details,
    };
  }
}
