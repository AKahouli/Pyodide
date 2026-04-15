import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConnectorCredentialDto {
  @ApiProperty({ description: 'Connector ID' })
  @IsString()
  connectorId!: string;

  @ApiProperty({ description: 'Display name for this credential' })
  @IsString()
  @MaxLength(128)
  displayName!: string;

  @ApiProperty({ description: 'Authentication payload (secrets, tokens, etc.)', type: Object })
  @IsObject()
  authPayload!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Expiration date (ISO string)' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
