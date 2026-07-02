import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const LANE_VALUES = [
  'backlog',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
] as const;
const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;
const ASSIGNEE_VALUES = ['ephemeral_ai_agent', 'human_agent', 'unassigned'] as const;
const CATEGORY_VALUES = [
  'internal_analysis',
  'research',
  'drafting',
  'internal_artifact_write',
  'internal_platform_notification',
  'external_send',
  'customer_facing_release',
  'external_comms',
  'budget_overrun',
  'cancel_human_task',
  'replanning',
] as const;

export class CreateTaskDeltaDto {
  @ApiPropertyOptional({ description: 'Runtime-stable id; used to wire dependsOn' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientTaskId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ enum: LANE_VALUES })
  @IsString()
  @IsEnum(LANE_VALUES as unknown as string[])
  lane!: (typeof LANE_VALUES)[number];

  @ApiPropertyOptional({ enum: ['pending', 'confirmed'] })
  @IsOptional()
  @IsString()
  planningStatus?: 'pending' | 'confirmed';

  @ApiPropertyOptional({ enum: PRIORITY_VALUES })
  @IsOptional()
  @IsString()
  @IsEnum(PRIORITY_VALUES as unknown as string[])
  priority?: (typeof PRIORITY_VALUES)[number];

  @ApiPropertyOptional({ enum: ASSIGNEE_VALUES })
  @IsOptional()
  @IsString()
  @IsEnum(ASSIGNEE_VALUES as unknown as string[])
  assigneeType?: (typeof ASSIGNEE_VALUES)[number];

  @ApiPropertyOptional({ type: [String], description: 'clientTaskId refs (or existing taskIds)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredTools?: string[];

  @ApiProperty({ enum: CATEGORY_VALUES })
  @IsString()
  @IsEnum(CATEGORY_VALUES as unknown as string[])
  actionCategory!: (typeof CATEGORY_VALUES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptanceCriteria?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetEstimateUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  tokensEstimate?: number;
}

export class UpdateTaskDeltaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  taskId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: LANE_VALUES })
  @IsOptional()
  @IsString()
  lane?: (typeof LANE_VALUES)[number];

  @ApiPropertyOptional({ enum: PRIORITY_VALUES })
  @IsOptional()
  @IsString()
  priority?: (typeof PRIORITY_VALUES)[number];

  @ApiPropertyOptional({ enum: ASSIGNEE_VALUES })
  @IsOptional()
  @IsString()
  @IsEnum(ASSIGNEE_VALUES as unknown as string[])
  assigneeType?: (typeof ASSIGNEE_VALUES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];

  @ApiPropertyOptional({ enum: CATEGORY_VALUES })
  @IsOptional()
  @IsString()
  actionCategory?: (typeof CATEGORY_VALUES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptanceCriteria?: string[];
}

export class CancelTaskDeltaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  taskId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ClarificationRequestDeltaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  question!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocksTaskClientIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blocksTaskIds?: string[];

  @ApiPropertyOptional({ enum: ['clarification', 'assignment_disambiguation'] })
  @IsOptional()
  @IsString()
  type?: 'clarification' | 'assignment_disambiguation';
}

/**
 * Validated body shape for `POST /worky/internal/streams/{id}/plan-delta`.
 * Replaces Part 1's opaque `Record<string, unknown>`. Optional arrays are
 * defaulted to `[]` in the plan-delta service so empty deltas are a no-op.
 */
export class PlanDeltaBodyDto {
  @ApiPropertyOptional({ type: [CreateTaskDeltaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTaskDeltaDto)
  create_tasks?: CreateTaskDeltaDto[];

  @ApiPropertyOptional({ type: [UpdateTaskDeltaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateTaskDeltaDto)
  update_tasks?: UpdateTaskDeltaDto[];

  @ApiPropertyOptional({ type: [CancelTaskDeltaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancelTaskDeltaDto)
  cancel_tasks?: CancelTaskDeltaDto[];

  @ApiPropertyOptional({ type: [ClarificationRequestDeltaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClarificationRequestDeltaDto)
  clarification_requests?: ClarificationRequestDeltaDto[];
}
