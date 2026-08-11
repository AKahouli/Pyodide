import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { RequestPlaybookFlowIntentDto } from './request-playbook-flow-intent.dto';
import { PreviewAdvisorRemediationItemDto } from './preview-advisor-remediation.dto';

export class OpenPlaybookAssistantContextDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  executionId?: string;
}

export class SearchPlaybooksDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  workspaceId?: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number = 10;
}

export class ListRecentExecutionsDto {
  @ApiPropertyOptional({ enum: ['running', 'failed', 'completed', 'waiting', 'cancelled'] })
  @IsOptional()
  @IsIn(['running', 'failed', 'completed', 'waiting', 'cancelled'])
  status?: 'running' | 'failed' | 'completed' | 'waiting' | 'cancelled';

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number = 10;
}

export class RunSecondBrainTurnDto {
  @ApiProperty()
  @IsString()
  @MaxLength(10000)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  conversationId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  pageContext?: Record<string, unknown>;
}

export class EvaluateMascotToolDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  toolName!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  arguments!: Record<string, unknown>;
}

export class RunPlaybookAssistantTurnDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50000)
  message!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  expectedDefinitionRevision!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  executionId?: string;
}

export class StartPlaybookAssistantConstructionDto extends RequestPlaybookFlowIntentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contextId?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  expectedDefinitionRevision!: number;
}

export class AnalyzeTaskOptimizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  executionId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(['clarity', 'agent', 'model', 'tools', 'inputs', 'outputs', 'bindings', 'cost', 'latency', 'determinism'], { each: true })
  dimensions?: string[];
}

export class AnalyzeWorkflowOptimizationDto extends AnalyzeTaskOptimizationDto {}

export class RunPlaybookFromStepDto {
  @ApiProperty()
  @IsString()
  taskId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  iteration?: number;
}

export class StartAdvisorRemediationConstructionDto {
  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedTaskId?: string;

  @ApiProperty({ enum: ['optimize-step', 'update-current', 'generate-new'] })
  @IsIn(['optimize-step', 'update-current', 'generate-new'])
  mode!: 'optimize-step' | 'update-current' | 'generate-new';

  @ApiProperty({ type: [PreviewAdvisorRemediationItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewAdvisorRemediationItemDto)
  items!: PreviewAdvisorRemediationItemDto[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  expectedDefinitionRevision!: number;
}

export class CancelPlaybookAssistantConstructionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
