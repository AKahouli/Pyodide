import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

class UpdatePlaybookIntentNormalizationLimitsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxWorkflowPlanChanges?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxInputPorts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxOutputPorts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxIteratorBodySteps?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxIteratorBodyEdges?: number;
}

class UpdateDynamicReasoningAdminSettingsDto {
  @ApiPropertyOptional({ description: 'Required planner agent for Dynamic Reasoning Workflow executions.' })
  @IsOptional()
  @IsMongoId()
  plannerAgentId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 32 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(32)
  maxWorkNodes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 32 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(32)
  maxParallelism?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1)
  maxDepth?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3)
  maxRepairAttempts?: number;
}

class UpdatePlaybookExecutionAdminSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  availableCapacity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxConcurrentPerUser?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxConcurrentPerFlow?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxConcurrentPerProvider?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxConcurrentPerModel?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 5000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000)
  executionQueueMaxDepth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  maxParallelismPerExecution?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  recursionLimitDefault?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  recursionLimitMax?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  maxHitlRounds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pythonWorkerPoolSize?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  pythonWorkerMaxInflight?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxToolIterations?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  maxSandboxCallsPerStep?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  graphCacheEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  graphCacheMaxEntries?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(86400)
  graphCacheTtlSeconds?: number;

  @ApiPropertyOptional({ type: UpdateDynamicReasoningAdminSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => UpdateDynamicReasoningAdminSettingsDto)
  dynamicReasoning?: UpdateDynamicReasoningAdminSettingsDto;
}

export class UpdateAdminPlaybookSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inferenceModelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  advisorEvaluationModelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  replayEvaluationModelId?: string | null;

  @ApiPropertyOptional({ enum: ['auto', 'manual'] })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  nodeSuggestionsMode?: 'auto' | 'manual';

  @ApiPropertyOptional({ enum: ['auto', 'manual'] })
  @IsOptional()
  @IsIn(['auto', 'manual'])
  approvalSuggestionMode?: 'auto' | 'manual';

  @ApiPropertyOptional({ type: UpdatePlaybookIntentNormalizationLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlaybookIntentNormalizationLimitsDto)
  intentNormalizationLimits?: UpdatePlaybookIntentNormalizationLimitsDto;

  @ApiPropertyOptional({ description: 'Use the deterministic blueprint builder path for intent.analyze and realtime construction.' })
  @IsOptional()
  @IsBoolean()
  useDeterministicBlueprintBuilder?: boolean;

  @ApiPropertyOptional({ type: UpdatePlaybookExecutionAdminSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlaybookExecutionAdminSettingsDto)
  playbookExecution?: UpdatePlaybookExecutionAdminSettingsDto;
}
