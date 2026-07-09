import { IsString, IsOptional, IsMongoId, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}

export class WidgetCreateSessionDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  visitorId!: string;
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
