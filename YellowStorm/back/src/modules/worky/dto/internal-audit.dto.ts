import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InternalAuditDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
