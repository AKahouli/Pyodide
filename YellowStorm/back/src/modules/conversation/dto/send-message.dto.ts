import { Type } from 'class-transformer';
import { IsString, IsOptional, IsBoolean, IsArray, IsMongoId, MaxLength, ValidateNested } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'ID of the message being replied to' })
  @IsOptional()
  @IsMongoId()
  parentMessageId?: string;

  @ApiPropertyOptional({ description: 'Selected connector repository for GitHub-scoped actions', type: ConnectorRepoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectorRepoDto)
  connectorRepo?: ConnectorRepoDto;
}
