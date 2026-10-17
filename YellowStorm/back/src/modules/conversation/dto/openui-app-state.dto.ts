import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, Matches, Max, Min, ValidateBy } from 'class-validator';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { isValidOpenUiSubmission } from './send-message.dto';

/** Reuse the same bounded, prototype-safe JSON transport as explicit submissions. */
export function isValidOpenUiAppState(value: unknown): value is Record<string, unknown> {
  if (!isValidOpenUiSubmission({ type: 'openui', schemaVersion: 1,
    sourceMessageId: '0'.repeat(24), componentId: 'draft', actionType: 'continue_conversation', formState: value })) return false;
  // JSONB cannot represent NUL or unpaired UTF-16 surrogates: reject instead of failing in SQL.
  const invalidText = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const supported = (item: unknown): boolean => typeof item === 'string' ? !invalidText.test(item)
    : Array.isArray(item) ? item.every(supported)
      : item && typeof item === 'object' ? Object.entries(item).every(([key, child]) => !invalidText.test(key) && supported(child)) : true;
  return supported(value);
}

export class PutOpenUiAppStateDto {
  @IsIn([1]) schemaVersion!: 1;
  @IsIn(['yellowstorm-miniapp-v1']) libraryVersion!: 'yellowstorm-miniapp-v1';
  @Matches(/^[a-f0-9]{64}$/) programDigest!: string;
  @IsInt() @Min(0) @Max(2_147_483_646) expectedRevision!: number;
  @Type(options => {
    if (!isValidOpenUiAppState(options?.object?.state)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid OpenUI app state');
    }
    return Object;
  })
  @Transform(({ obj }) => obj.state, { toClassOnly: true })
  @ValidateBy({ name: 'boundedOpenUiAppState', validator: { validate: isValidOpenUiAppState } })
  state!: Record<string, unknown>;
}

export interface OpenUiAppStateResponse {
  schemaVersion: 1;
  libraryVersion: 'yellowstorm-miniapp-v1';
  programDigest: string;
  stateRevision: number;
  state: Record<string, unknown>;
  updatedAt: Date | null;
  canWrite: true;
}
