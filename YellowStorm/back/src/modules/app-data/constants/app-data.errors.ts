import { HttpException, HttpStatus } from '@nestjs/common';

export enum AppDataErrorCode {
  DISABLED = 'APP_DATA_DISABLED',
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

export class AppDataException extends HttpException {
  constructor(
    public readonly appDataCode: AppDataErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly data?: Record<string, unknown>,
  ) {
    super({ message, code: appDataCode, ...data }, status);
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
