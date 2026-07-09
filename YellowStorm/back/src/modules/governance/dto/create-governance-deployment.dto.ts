import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGovernanceDeploymentDto {
  @ApiProperty()
  @IsMongoId()
  scopeId!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  channels?: Record<string, unknown>;
}
