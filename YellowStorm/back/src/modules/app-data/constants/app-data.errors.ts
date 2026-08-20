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
