import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES = [
  'task_title',
  'task_description',
  'agent_selection',
  'datasource_connection',
  'input_contract',
  'output_contract',
  'general',
] as const;

export type PlaybookNodeAdvisorSuggestionType =
  (typeof PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES)[number];

export class RequestPlaybookNodeAdvisorDto {
  @ApiPropertyOptional({ description: 'Optional user intent to bias the advisor output.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  intent?: string;

  @ApiPropertyOptional({
    description: 'Suggestion categories to request. Defaults to all supported categories.',
    enum: PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES, { each: true })
  suggestionTypes?: PlaybookNodeAdvisorSuggestionType[];

  @ApiPropertyOptional({ description: 'Include graph context when generating suggestions.', default: true })
  @IsOptional()
  @IsBoolean()
  includeGraphContext?: boolean;

  @ApiPropertyOptional({ description: 'Unsaved title draft for the selected task.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Unsaved description draft for the selected task.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;
}
