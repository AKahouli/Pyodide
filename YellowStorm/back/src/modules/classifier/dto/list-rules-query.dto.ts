import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClassifierRuleScope } from '../classifier.types';

export class ListRulesQueryDto {
  @ApiPropertyOptional({ enum: ClassifierRuleScope, description: 'Filter by scope' })
  @IsOptional()
  @IsEnum(ClassifierRuleScope)
  scope?: ClassifierRuleScope;

  @ApiPropertyOptional({ description: 'Workspace ID (required when scope=local)' })
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;
}
