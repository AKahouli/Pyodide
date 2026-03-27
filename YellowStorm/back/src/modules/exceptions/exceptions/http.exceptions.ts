import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { ErrorDetail } from '../interfaces/error-response.interface';
import { AppException } from './base.exception';

export class BadRequestException extends AppException {
  constructor(codeOrMessage?: ErrorCode | string, message?: string, details?: ErrorDetail[]) {
    // Check if first argument is an ErrorCode or a string message
    const isErrorCode = codeOrMessage && Object.values(ErrorCode).includes(codeOrMessage as ErrorCode);
    const code = isErrorCode ? (codeOrMessage as ErrorCode) : ErrorCode.BAD_REQUEST;
    const msg = isErrorCode ? message : (codeOrMessage as string | undefined);

    super({
      code,
      message: msg,
      statusCode: HttpStatus.BAD_REQUEST,
      details,
    });
  }
}

export class ValidationException extends AppException {
  constructor(details: ErrorDetail[], message?: string) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      message: message || 'Validation failed',
      statusCode: HttpStatus.BAD_REQUEST,
      details,
    });
  }
}

export class UnauthorizedException extends AppException {
  constructor(code: ErrorCode = ErrorCode.UNAUTHORIZED, message?: string) {
    super({
      code,
      message,
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  }
}

export class ForbiddenException extends AppException {
  constructor(code: ErrorCode = ErrorCode.FORBIDDEN, message?: string) {
    super({
      code,
      message,
      statusCode: HttpStatus.FORBIDDEN,
    });
  }
}

export class NotFoundException extends AppException {
  constructor(code: ErrorCode = ErrorCode.NOT_FOUND, message?: string) {
    super({
      code,
      message,
      statusCode: HttpStatus.NOT_FOUND,
    });
  }
}

export class ConflictException extends AppException {
  constructor(code: ErrorCode = ErrorCode.CONFLICT, message?: string) {
    super({
      code,
      message,
      statusCode: HttpStatus.CONFLICT,
    });
  }
}

export class TooManyRequestsException extends AppException {
  constructor(message?: string) {
    super({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
    });
  }
}

export class InternalServerException extends AppException {
  constructor(originalError?: Error, message?: string) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      message,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      originalError,
    });
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE, message?: string) {
    super({
      code,
      message,
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    });
  }
}
