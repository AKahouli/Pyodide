import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InspectConnectorDto {
  @ApiPropertyOptional({ description: 'Use OAuth token from connected app for authentication' })
  @IsOptional()
  @IsBoolean()
  useOAuth?: boolean;
}
