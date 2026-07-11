import { Type } from 'class-transformer';
import { IsString, IsOptional, IsBoolean, IsArray, IsMongoId, MaxLength, ValidateNested, IsIn } from 'class-validator';
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

class ChoiceSelectionDto {
  @IsString() @MaxLength(64) optionId!: string;
  @IsString() @MaxLength(160) label!: string;
  @IsOptional() @IsString() @MaxLength(200) value?: string;
}

class ChoiceInteractionDto {
  @IsIn(['choice']) type!: 'choice';
  @IsString() @MaxLength(128) componentId!: string;
  @IsString() @MaxLength(100) questionId!: string;
  @IsOptional() @IsString() @MaxLength(128) sourceMessageId?: string;
  @IsIn(['single', 'multiple']) selectionMode!: 'single' | 'multiple';
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChoiceSelectionDto) selectedOptions!: ChoiceSelectionDto[];
  @IsOptional() @IsString() @MaxLength(2000) customAnswer?: string;
  @IsOptional() @IsBoolean() dismissed?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) displayText?: string;
}

export class SendMessageDto {
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
}
