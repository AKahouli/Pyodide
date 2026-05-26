import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClassifierRuleScope } from '../schemas/classifier-rule.schema';

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
