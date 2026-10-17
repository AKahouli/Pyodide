import { Type, Transform } from 'class-transformer';
import { IsString, IsOptional, IsBoolean, IsArray, IsMongoId, IsUUID, MaxLength, ValidateNested, IsIn, ArrayMaxSize, ArrayUnique, Matches, IsNotEmpty,IsInt, Min, Max, ValidateBy } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RootContinuationDto } from './root-continuation.dto';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

class ConnectorRepoDto {
  @ApiProperty()
  @IsString()
  connectorId!: string;

  @ApiProperty()
  @IsString()
  connectorName!: string;

  @ApiProperty()
  @IsString()
  repoId!: string;

  @ApiProperty()
  @IsString()
  repoName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repoUrl?: string;
}

class ClientContextEntityDto {
  @IsIn(['playbook', 'execution', 'task']) type!: 'playbook' | 'execution' | 'task';
  @IsString() @IsNotEmpty() @MaxLength(200) id!: string;
}

export class ConversationClientContextDto {
  @IsInt() @Min(1) @Max(1) contextVersion!: 1;
  @IsString() @MaxLength(1000) route!: string;
  @IsIn(['playbooks', 'executions', 'other']) module!: 'playbooks' | 'executions' | 'other';
  @IsString() @MaxLength(100) surface!: string;
  @IsOptional() @ValidateNested() @Type(() => ClientContextEntityDto) entity?: ClientContextEntityDto;
  @IsOptional() @ValidateNested() @Type(() => ClientContextEntityDto) selection?: ClientContextEntityDto;
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @MaxLength(100, { each: true }) availableActions!: string[];
  @IsBoolean() hasUnsavedChanges!: boolean;
  @IsString() @MaxLength(35) locale!: string;
}

export class ChoiceSelectionDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]+$/) @MaxLength(64) optionId!: string;
  @IsString() @MaxLength(160) label!: string;
  @IsOptional() @IsString() @MaxLength(200) value?: string;
}

export class ChoiceInteractionDto {
  @IsIn(['choice']) type!: 'choice';
  @IsString() @MaxLength(128) componentId!: string;
  @IsString() @MaxLength(100) questionId!: string;
  @IsMongoId() sourceMessageId!: string;
  @IsIn(['single', 'multiple']) selectionMode!: 'single' | 'multiple';
  @IsArray() @ArrayMaxSize(10) @ArrayUnique((item: ChoiceSelectionDto) => item.optionId) @ValidateNested({ each: true }) @Type(() => ChoiceSelectionDto) selectedOptions!: ChoiceSelectionDto[];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) customAnswer?: string;
  @IsOptional() @IsBoolean() dismissed?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(1000) displayText?: string;
}

/** Structural transport validation only; form values remain untrusted user input. */
export class OpenUiSubmissionDto {
  @IsIn(['openui']) type!: 'openui';
  @IsIn([1]) schemaVersion!: 1;
  @IsMongoId() sourceMessageId!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) componentId!: string;
  @IsIn(['continue_conversation']) actionType!: 'continue_conversation';
  @IsOptional() @IsString() @MaxLength(128) formName?: string;
  @IsOptional() @IsString() @MaxLength(1000) label?: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  formState!: Record<string, unknown>;
  @ApiPropertyOptional({
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer', enum: [1] },
      programDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      stateRevision: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
      documentIds: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', pattern: '^[a-f0-9]{24}$' } },
    },
    additionalProperties: false,
  })
  appTask?: { schemaVersion: 1; programDigest: string; stateRevision: number; documentIds: string[] };
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  params?: Record<string, unknown>;
}

export function isValidOpenUiSubmission(value: unknown): value is OpenUiSubmissionDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null, OpenUiSubmissionDto.prototype].includes(Object.getPrototypeOf(value))) return false;
  const submission = value as Record<string, unknown>;
  const keys = new Set(['type', 'schemaVersion', 'sourceMessageId', 'componentId', 'actionType', 'formName', 'label', 'formState', 'params', 'appTask']);
  if (Reflect.ownKeys(submission).some(key => typeof key !== 'string' || !keys.has(key)
    || Object.getOwnPropertyDescriptor(submission, key)?.get !== undefined
    || Object.getOwnPropertyDescriptor(submission, key)?.set !== undefined
    || !Object.getOwnPropertyDescriptor(submission, key)?.enumerable)) return false;
  if (submission.type !== 'openui' || submission.schemaVersion !== 1 || submission.actionType !== 'continue_conversation'
    || typeof submission.sourceMessageId !== 'string' || !/^[a-f\d]{24}$/i.test(submission.sourceMessageId)
    || typeof submission.componentId !== 'string' || !submission.componentId.length || submission.componentId.length > 128
    || (submission.formName !== undefined && (typeof submission.formName !== 'string' || submission.formName.length > 128))
    || (submission.label !== undefined && (typeof submission.label !== 'string' || submission.label.length > 1000))) return false;
  if (submission.appTask !== undefined) {
    const task = submission.appTask as Record<string, unknown>;
    if (!task || typeof task !== 'object' || Array.isArray(task) || Object.getPrototypeOf(task) !== Object.prototype
      || Reflect.ownKeys(task).some(key => typeof key !== 'string' || !['schemaVersion', 'programDigest', 'stateRevision', 'documentIds'].includes(key)
        || Object.getOwnPropertyDescriptor(task, key)?.get !== undefined || Object.getOwnPropertyDescriptor(task, key)?.set !== undefined)
      || task.schemaVersion !== 1 || typeof task.programDigest !== 'string' || !/^[a-f0-9]{64}$/.test(task.programDigest)
      || !Number.isSafeInteger(task.stateRevision) || (task.stateRevision as number) < 0 || (task.stateRevision as number) > 2_147_483_647
      || !Array.isArray(task.documentIds) || task.documentIds.length > 5
      || task.documentIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      || new Set(task.documentIds).size !== task.documentIds.length) return false;
    const params = submission.params as Record<string, unknown> | undefined;
    if (!params || typeof params.instruction !== 'string' || !params.instruction.trim() || params.instruction.length > 4000
      || !params.inputs || typeof params.inputs !== 'object' || Array.isArray(params.inputs)) return false;
  }
  let items = 0;
  const seen = new Set<object>();
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object'
    && !Array.isArray(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item));
  const visit = (item: unknown, depth: number): boolean => {
    if (++items > 200 || depth > 8) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || !item || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) return item.length <= 200
      && Reflect.ownKeys(item).every(key => key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
        && Object.getOwnPropertyDescriptor(item, key)?.get === undefined
        && Object.getOwnPropertyDescriptor(item, key)?.set === undefined
        && Object.getOwnPropertyDescriptor(item, key)?.enumerable === true))
      && Array.from({ length: item.length }, (_, index) => Object.prototype.hasOwnProperty.call(item, index) && visit(item[index], depth + 1)).every(Boolean);
    return record(item) && Reflect.ownKeys(item).every(key => typeof key === 'string'
      && !['__proto__', 'prototype', 'constructor'].includes(key)
      && Object.getOwnPropertyDescriptor(item, key)?.get === undefined
      && Object.getOwnPropertyDescriptor(item, key)?.set === undefined
      && Object.getOwnPropertyDescriptor(item, key)?.enumerable === true
      && visit(item[key], depth + 1));
  };
  if ((submission.appTask !== undefined && !visit(submission.appTask, 0))
    || !record(submission.formState) || !visit(submission.formState, 0)
    || (submission.params !== undefined && (!record(submission.params) || !visit(submission.params, 0)))) return false;
  try { return Buffer.byteLength(JSON.stringify(submission), 'utf8') <= 20 * 1024; } catch { return false; }
}

export class SendMessageDto {
  @ApiPropertyOptional({ type: OpenUiSubmissionDto })
  // Validate original JSON: class-transformer's key filtering must not silently accept a changed payload.
  @Type(options => {
    // Bounds and dangerous keys must be checked before the transformer traverses arbitrary form JSON.
    const value: unknown = options?.object?.openUiSubmission;
    if (value !== undefined && !isValidOpenUiSubmission(value)) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid OpenUI submission');
    }
    return Object;
  })
  @Transform(({ obj }) => obj.openUiSubmission, { toClassOnly: true })
  @IsOptional()
  @ValidateBy({ name: 'boundedOpenUiSubmission', validator: {
    validate: isValidOpenUiSubmission,
    defaultMessage: () => 'openUiSubmission must be a bounded OpenUI form submission',
  } })
  openUiSubmission?: OpenUiSubmissionDto;

  @ApiPropertyOptional({ type: RootContinuationDto })
  @IsOptional() @ValidateNested() @Type(() => RootContinuationDto)
  rootContinuation?: RootContinuationDto;
  @ApiPropertyOptional({ description: 'Stable identifier for retrying this logical message turn', maxLength: 128 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]+$/)
  @MaxLength(128)
  requestId?: string;

  @ApiPropertyOptional({ description: 'Opaque prepared Conversation-to-Playbook handoff identifier' })
  @IsOptional()
  @IsUUID()
  playbookHandoffId?: string;

  @ApiProperty({ maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  content!: string;

  @ApiPropertyOptional({ description: 'File IDs already uploaded to system workspace', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  attachedFileIds?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  webSearchEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Allow agents to use connectors in the Web Search category', default: true })
  @IsOptional()
  @IsBoolean()
  webConnectorAccessEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  deepSearchEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Model ID to use for AI response' })
  @IsOptional()
  @IsString()
  modelId?: string;

  @ApiPropertyOptional({ description: 'Accessible semantic model used by the semantic search tool' })
  @IsOptional()
  @IsUUID()
  semanticModelId?: string;

  @ApiPropertyOptional({ description: 'Reasoning effort ID supported by the selected model', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(50)
  reasoningEffort?: string;

  @ApiPropertyOptional({ description: 'Mentioned agent IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  agentIds?: string[];

  @ApiPropertyOptional({ description: 'Mentioned member IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  memberIds?: string[];

  @ApiPropertyOptional({ description: 'Mentioned team IDs; expanded into their agents at send time', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  teamIds?: string[];

  @ApiPropertyOptional({ description: 'ID of the message being replied to' })
  @IsOptional()
  @IsMongoId()
  parentMessageId?: string;

  @ApiPropertyOptional({ description: 'Selected connector repository for GitHub-scoped actions', type: ConnectorRepoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectorRepoDto)
  connectorRepo?: ConnectorRepoDto;

  @ApiPropertyOptional({ description: 'Selected skill IDs applied to this conversation', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  skillIds?: string[];

  @ApiPropertyOptional({ type: ChoiceInteractionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChoiceInteractionDto)
  interaction?: ChoiceInteractionDto;

  @ApiPropertyOptional({ description: 'Multiple choice answers submitted together in a single turn', type: [ChoiceInteractionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChoiceInteractionDto)
  interactions?: ChoiceInteractionDto[];

  @ApiPropertyOptional({ type: ConversationClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationClientContextDto)
  clientContext?: ConversationClientContextDto;
}
