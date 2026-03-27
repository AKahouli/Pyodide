import { IsBoolean, IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetMaintenanceDto {
  @ApiProperty({
    description: 'Enable or disable maintenance mode',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    description: 'Message to display to users during maintenance',
    example: 'We are upgrading our systems. Please check back in 30 minutes.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional({
    description: 'Estimated time when maintenance will end (ISO 8601)',
    example: '2024-01-16T15:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  estimatedEndAt?: string;
}
