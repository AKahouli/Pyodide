import { IsString, IsOptional, MaxLength, ValidateNested, IsArray, IsBoolean, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class WidgetClientContextDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  origin?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referrer?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;
}

class WidgetChoiceSelectionDto {
  @IsString() @MaxLength(64) optionId!: string;
  @IsString() @MaxLength(160) label!: string;
  @IsOptional() @IsString() @MaxLength(200) value?: string;
}

class WidgetChoiceInteractionDto {
  @IsIn(['choice']) type!: 'choice';
  @IsString() @MaxLength(128) componentId!: string;
  @IsString() @MaxLength(100) questionId!: string;
  @IsIn(['single', 'multiple']) selectionMode!: 'single' | 'multiple';
  @IsArray() @ValidateNested({ each: true }) @Type(() => WidgetChoiceSelectionDto) selectedOptions!: WidgetChoiceSelectionDto[];
  @IsOptional() @IsString() @MaxLength(2000) customAnswer?: string;
  @IsOptional() @IsBoolean() dismissed?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) displayText?: string;
}

export class WidgetSendMessageDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  visitorId?: string;

  @ApiPropertyOptional({ type: WidgetClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetClientContextDto)
  clientContext?: WidgetClientContextDto;

  @ApiPropertyOptional({ type: WidgetChoiceInteractionDto })
  @IsOptional() @ValidateNested() @Type(() => WidgetChoiceInteractionDto)
  interaction?: WidgetChoiceInteractionDto;
}

export class WidgetCreateSessionDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  visitorId!: string;

  @ApiPropertyOptional({ type: WidgetClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetClientContextDto)
  clientContext?: WidgetClientContextDto;
}

export class CreateWidgetTokenDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class WidgetCitationUrlDto {
  @ApiProperty({ description: 'Ceph object key or source path from citation data' })
  @IsString()
  @MaxLength(1024)
  source!: string;

  @ApiPropertyOptional({ description: 'Original filename for workspace lookup fallback' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ description: 'Workspace ID for document lookup fallback' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  workspaceId?: string;
}

export class UpdateWidgetTokenDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
