import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, IsMongoId, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';

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

export class UpdateConversationSettingsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  redactSensitiveText?: boolean;

  @ApiProperty({ type: UpdateComposerSuggestionSettingsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateComposerSuggestionSettingsDto)
  composerSuggestions!: UpdateComposerSuggestionSettingsDto;
}

export class UpdateSensitiveTextRedactionDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  redactSensitiveText!: boolean;
}
