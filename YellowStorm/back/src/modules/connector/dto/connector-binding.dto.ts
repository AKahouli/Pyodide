import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ConnectorBindingActionDto {
  @ApiProperty({ description: 'Connector action key' })
  @IsString()
  @MaxLength(128)
  actionKey!: string;

  @ApiPropertyOptional({ description: 'Whether this action is enabled in the binding', default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class ConnectorBindingDto {
  @ApiProperty({ description: 'Unique binding ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Connector ID' })
  @IsString()
  connectorId!: string;

  @ApiProperty({ description: 'Allowed actions for this binding' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConnectorBindingActionDto)
  actions!: ConnectorBindingActionDto[];

  @ApiPropertyOptional({ description: 'Credential ID to use for authentication' })
  @IsOptional()
  @IsString()
  credentialId?: string | null;

  @ApiPropertyOptional({ description: 'Fixed parameter values that the AI cannot override', type: Object })
  @IsOptional()
  @IsObject()
  fixedParams?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether auto-attached skills from this connector are disabled', default: false })
  @IsOptional()
  @IsBoolean()
  disableAutoSkills?: boolean;

  @ApiPropertyOptional({ description: 'Whether this binding is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
