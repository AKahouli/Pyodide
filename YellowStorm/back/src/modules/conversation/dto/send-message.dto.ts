import { Type } from 'class-transformer';
import { IsString, IsOptional, IsBoolean, IsArray, IsMongoId, MaxLength, ValidateNested, IsIn, ArrayMaxSize, ArrayUnique, Matches, IsNotEmpty, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'Stable identifier for retrying this logical message turn', maxLength: 128 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]+$/)
  @MaxLength(128)
  requestId?: string;

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

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  deepSearchEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Model ID to use for AI response' })
  @IsOptional()
  @IsString()
  modelId?: string;

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

  @ApiPropertyOptional({ type: ConversationClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationClientContextDto)
  clientContext?: ConversationClientContextDto;
}
