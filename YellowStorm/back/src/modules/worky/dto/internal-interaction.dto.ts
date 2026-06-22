import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WORKY_INTERACTION_TYPES, WORKY_INTERACTION_BLOCKING_SCOPES } from '../constants/worky.constants';

export class InternalInteractionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({ enum: WORKY_INTERACTION_TYPES })
  @IsIn(WORKY_INTERACTION_TYPES as unknown as string[])
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  options?: string[];

  @ApiPropertyOptional({ enum: WORKY_INTERACTION_BLOCKING_SCOPES })
  @IsOptional()
  @IsIn(WORKY_INTERACTION_BLOCKING_SCOPES as unknown as string[])
  blockingScope?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
