import { IsBoolean, IsEnum, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassifierRuleScope } from '../classifier.types';

export class CreateRuleDto {
  @ApiProperty({ enum: ClassifierRuleScope, description: 'Rule scope: global (all workspaces) or local (single workspace)' })
  @IsEnum(ClassifierRuleScope)
  scope!: ClassifierRuleScope;

  @ApiPropertyOptional({ description: 'Workspace ID (required when scope=local)' })
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @ApiProperty({ description: 'Free-form rule text', minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @ApiPropertyOptional({ description: 'Initial enabled state (default true)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
