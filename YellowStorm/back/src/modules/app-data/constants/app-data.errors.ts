import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

export enum AppDataErrorCode {
  DISABLED = 'APP_DATA_DISABLED',
  REMOTE_UNAVAILABLE = 'APP_DATA_REMOTE_UNAVAILABLE',
  NOT_PROVISIONED = 'APP_DATA_NOT_PROVISIONED',
  INVALID_IDENTIFIER = 'APP_DATA_INVALID_IDENTIFIER',
  INVALID_MANIFEST = 'APP_DATA_INVALID_MANIFEST',
  VERSION_CONFLICT = 'APP_DATA_VERSION_CONFLICT',
  DESTRUCTIVE_BLOCKED = 'APP_DATA_DESTRUCTIVE_BLOCKED',
  PROD_DOWNGRADE_BLOCKED = 'APP_DATA_PROD_DOWNGRADE_BLOCKED',
  POLICY_DENIED = 'APP_DATA_POLICY_DENIED',
  ROW_NOT_FOUND = 'APP_DATA_ROW_NOT_FOUND',
  LIMIT_EXCEEDED = 'APP_DATA_LIMIT_EXCEEDED',
  BINDING_NOT_FOUND = 'APP_DATA_BINDING_NOT_FOUND',
  ENVIRONMENT_FORBIDDEN = 'APP_DATA_ENVIRONMENT_FORBIDDEN',
  DEPLOY_CONFIG_MISSING = 'APP_DATA_DEPLOY_CONFIG_MISSING',
  AUTH_REQUIRED = 'APP_DATA_AUTH_REQUIRED',
  AUTH_INVALID = 'APP_DATA_AUTH_INVALID',
  EMAIL_TAKEN = 'APP_DATA_EMAIL_TAKEN',
  USER_DISABLED = 'APP_DATA_USER_DISABLED',
  GRANT_DENIED = 'APP_DATA_GRANT_DENIED',
  INVITE_INVALID = 'APP_DATA_INVITE_INVALID',
  INVITE_EXPIRED = 'APP_DATA_INVITE_EXPIRED',
  INVITE_CONSUMED = 'APP_DATA_INVITE_CONSUMED',
  INVITE_MISMATCH = 'APP_DATA_INVITE_MISMATCH',
}

/**
 * Maps backend AppDataErrorCode to the central ErrorCode enum.
 * Used in HTTP responses and MCP JSON-RPC errors so the frontend
 * can resolve user-friendly messages without a hardcoded mapping.
 */
export const APP_DATA_ERROR_CODES: Record<AppDataErrorCode, ErrorCode> = {
  [AppDataErrorCode.DISABLED]: ErrorCode.APP_DATA_DISABLED,
  [AppDataErrorCode.REMOTE_UNAVAILABLE]: ErrorCode.APP_DATA_REMOTE_UNAVAILABLE,
  [AppDataErrorCode.NOT_PROVISIONED]: ErrorCode.APP_DATA_NOT_PROVISIONED,
  [AppDataErrorCode.INVALID_IDENTIFIER]: ErrorCode.APP_DATA_INVALID_IDENTIFIER,
  [AppDataErrorCode.INVALID_MANIFEST]: ErrorCode.APP_DATA_INVALID_MANIFEST,
  [AppDataErrorCode.VERSION_CONFLICT]: ErrorCode.APP_DATA_VERSION_CONFLICT,
  [AppDataErrorCode.DESTRUCTIVE_BLOCKED]: ErrorCode.APP_DATA_DESTRUCTIVE_BLOCKED,
  [AppDataErrorCode.PROD_DOWNGRADE_BLOCKED]: ErrorCode.APP_DATA_PROD_DOWNGRADE_BLOCKED,
  [AppDataErrorCode.POLICY_DENIED]: ErrorCode.APP_DATA_POLICY_DENIED,
  [AppDataErrorCode.ROW_NOT_FOUND]: ErrorCode.APP_DATA_ROW_NOT_FOUND,
  [AppDataErrorCode.LIMIT_EXCEEDED]: ErrorCode.APP_DATA_LIMIT_EXCEEDED,
  [AppDataErrorCode.BINDING_NOT_FOUND]: ErrorCode.APP_DATA_BINDING_NOT_FOUND,
  [AppDataErrorCode.ENVIRONMENT_FORBIDDEN]: ErrorCode.APP_DATA_ENVIRONMENT_FORBIDDEN,
  [AppDataErrorCode.DEPLOY_CONFIG_MISSING]: ErrorCode.APP_DATA_DEPLOY_CONFIG_MISSING,
  [AppDataErrorCode.AUTH_REQUIRED]: ErrorCode.APP_DATA_AUTH_REQUIRED,
  [AppDataErrorCode.AUTH_INVALID]: ErrorCode.APP_DATA_AUTH_INVALID,
  [AppDataErrorCode.EMAIL_TAKEN]: ErrorCode.APP_DATA_EMAIL_TAKEN,
  [AppDataErrorCode.USER_DISABLED]: ErrorCode.APP_DATA_USER_DISABLED,
  [AppDataErrorCode.GRANT_DENIED]: ErrorCode.APP_DATA_GRANT_DENIED,
  [AppDataErrorCode.INVITE_INVALID]: ErrorCode.APP_DATA_INVITE_INVALID,
  [AppDataErrorCode.INVITE_EXPIRED]: ErrorCode.APP_DATA_INVITE_EXPIRED,
  [AppDataErrorCode.INVITE_CONSUMED]: ErrorCode.APP_DATA_INVITE_CONSUMED,
  [AppDataErrorCode.INVITE_MISMATCH]: ErrorCode.APP_DATA_INVITE_MISMATCH,
};

export class AppDataException extends HttpException {
  constructor(
    public readonly appDataCode: AppDataErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly data?: Record<string, unknown>,
  ) {
    super(
      {
        message,
        code: appDataCode,
        errorCode: APP_DATA_ERROR_CODES[appDataCode] ?? 'ERR_1000',
        ...data,
      },
      status,
    );
  }
}

export class AppDataPolicyDeniedException extends AppDataException {
  constructor(table: string, operation: string, principal: string) {
    super(
      AppDataErrorCode.POLICY_DENIED,
      `Policy denied ${operation} on ${table} for principal ${principal}`,
      HttpStatus.FORBIDDEN,
      { table, operation, principal },
    );
  }
}

export class AppDataVersionConflictException extends AppDataException {
  constructor(expected: number, actual: number) {
    super(
      AppDataErrorCode.VERSION_CONFLICT,
      `Schema version conflict: expected ${expected}, actual ${actual}`,
      HttpStatus.CONFLICT,
      { expectedVersion: expected, actualVersion: actual },
    );
  }
}

export class AppDataGrantDeniedException extends AppDataException {
  constructor(operation: string) {
    super(
      AppDataErrorCode.GRANT_DENIED,
      `Permission denied for operation: ${operation}`,
      HttpStatus.FORBIDDEN,
      { operation },
    );
  }
}
