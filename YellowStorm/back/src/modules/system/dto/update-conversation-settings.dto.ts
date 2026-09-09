import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, IsMongoId, IsNumber, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class UpdateComposerSuggestionSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsMongoId()
  agentId!: string | null;

  @ApiProperty({ minimum: 250, maximum: 2000 })
  @Type(() => Number)
  @IsInt()
  @Min(250)
  @Max(2000)
  debounceMs!: number;

  @ApiProperty({ minimum: 3, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(200)
  minimumDraftLength!: number;

  @ApiProperty({ minimum: 1, maximum: 120 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  requestsPerMinute!: number;

  @ApiProperty({ minimum: 32, maximum: 1024 })
  @Type(() => Number)
  @IsInt()
  @Min(32)
  @Max(1024)
  maxOutputTokens!: number;
}

export class UpdateConversationNameSettingsDto {
  // modelId is the model catalog identifier (model_name, e.g. "gpt-5.4-mini"),
  // not a Mongo ObjectId — ModelsService.findById looks it up by that field.
  @ApiPropertyOptional({ nullable: true, description: 'Model identifier (model_name) used to generate conversation titles. Null = platform default model.' })
  @IsOptional()
  @IsString()
  modelId!: string | null;
}

export class UpdateCompactionSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 1000, description: 'Sliding window: new invocations between compactions (0 = off)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  compactionInterval!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  overlapSize!: number;

  @ApiProperty({ minimum: 0, maximum: 1, description: 'Token trigger: threshold = tokenFraction * context window (0 = off)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  tokenFraction!: number;

  @ApiProperty({ minimum: 0, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  eventRetentionSize!: number;

  @ApiProperty({ description: 'LiteLLM model used to summarize; empty = fall back to the chat model' })
  @IsString()
  summarizerModel!: string;
}

export class UpdateConversationSettingsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  redactSensitiveText?: boolean;

  @ApiPropertyOptional({ type: UpdateConversationNameSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateConversationNameSettingsDto)
  conversationName?: UpdateConversationNameSettingsDto;

  @ApiPropertyOptional({ default: true, description: 'End-to-end latency instrumentation for classic Conversation turns' })
  @IsOptional()
  @IsBoolean()
  latencyInstrumentationEnabled?: boolean;

  @ApiProperty({ type: UpdateComposerSuggestionSettingsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateComposerSuggestionSettingsDto)
  composerSuggestions!: UpdateComposerSuggestionSettingsDto;

  @ApiPropertyOptional({ type: UpdateCompactionSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateCompactionSettingsDto)
  compaction?: UpdateCompactionSettingsDto;
}

export class UpdateSensitiveTextRedactionDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  redactSensitiveText!: boolean;
}
