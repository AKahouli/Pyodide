import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  MaxLength,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType, NotificationPriority } from '../schemas/notification.schema';

export class NotificationActionDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  url?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  action?: string;
}

export class NotificationMetadataDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  sourceModule!: string;

  @ApiPropertyOptional({ enum: NotificationPriority })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiresAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}

export class CreateNotificationDto {
  @ApiPropertyOptional({ description: 'Target user ID (null for broadcast)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ description: 'Flexible JSON payload for UI' })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [NotificationActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationActionDto)
  actions?: NotificationActionDto[];

  @ApiProperty({ description: 'userId, "broadcast", or "role:admin"' })
  @IsString()
  destination!: string;

  @ApiProperty({ type: NotificationMetadataDto })
  @ValidateNested()
  @Type(() => NotificationMetadataDto)
  metadata!: NotificationMetadataDto;
}

/**
 * Internal DTO for sending notifications from other modules
 * Does not require destination (set by sendToUser/broadcast methods)
 */
export class InternalNotificationDto {
  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationActionDto)
  actions?: NotificationActionDto[];

  @ValidateNested()
  @Type(() => NotificationMetadataDto)
  metadata!: NotificationMetadataDto;
}
