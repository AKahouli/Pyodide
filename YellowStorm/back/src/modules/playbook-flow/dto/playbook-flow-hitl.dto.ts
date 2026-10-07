import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  HITL_BLOCKER_ACTIONS,
  HITL_BLOCKER_KINDS,
  HITL_FEEDBACK_SCOPES,
  HITL_MODES,
  HITL_RISK_LEVELS,
  HITL_SENSITIVITIES,
} from '../models/playbook-flow-hitl.model';

export class UpdateHitlPolicyDto {
  @ApiPropertyOptional({ enum: HITL_MODES })
  @IsOptional()
  @IsIn(HITL_MODES)
  mode?: string;

  @ApiPropertyOptional({ enum: HITL_SENSITIVITIES })
  @IsOptional()
  @IsIn(HITL_SENSITIVITIES)
  sensitivity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  clarificationEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approvalEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reviewEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  propagateFeedbackDefault?: boolean;

  @ApiPropertyOptional({ enum: HITL_FEEDBACK_SCOPES })
  @IsOptional()
  @IsIn(HITL_FEEDBACK_SCOPES)
  defaultFeedbackScope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inheritedFromWorkflow?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  disabledReason?: string | null;
}

export class CreateHitlBlockerDto {
  @ApiPropertyOptional({ enum: ['workflow', 'node'], default: 'workflow' })
  @IsOptional()
  @IsIn(['workflow', 'node'])
  scope?: 'workflow' | 'node';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  nodeId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ enum: HITL_BLOCKER_KINDS })
  @IsIn(HITL_BLOCKER_KINDS)
  kind!: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty({ enum: HITL_BLOCKER_ACTIONS })
  @IsIn(HITL_BLOCKER_ACTIONS)
  action!: string;

  @ApiPropertyOptional({ enum: HITL_RISK_LEVELS, default: 'medium' })
  @IsOptional()
  @IsIn(HITL_RISK_LEVELS)
  riskLevel?: string;

  @ApiPropertyOptional({ enum: HITL_SENSITIVITIES, default: 'balanced' })
  @IsOptional()
  @IsIn(HITL_SENSITIVITIES)
  sensitivity?: string;

  @ApiPropertyOptional({ enum: ['deterministic', 'tool_action', 'input_binding', 'llm_judge', 'custom_expression'] })
  @IsOptional()
  @IsIn(['deterministic', 'tool_action', 'input_binding', 'llm_judge', 'custom_expression'])
  matcherType?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  matcherConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  promptTemplate?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliesToToolNames?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliesToConnectorActions?: string[];
}

export class UpdateHitlBlockerDto extends PartialType(CreateHitlBlockerDto) {}

export class NormalizeHitlBlockerDto {
  @ApiProperty()
  @IsString()
  description!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  nodeId?: string | null;
}

export class CreateHitlMemoryDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  nodeId?: string | null;

  @ApiPropertyOptional({ enum: ['semantic', 'episodic', 'procedural', 'approval_policy'], default: 'procedural' })
  @IsOptional()
  @IsIn(['semantic', 'episodic', 'procedural', 'approval_policy'])
  memoryType?: string;

  @ApiPropertyOptional({ enum: ['hitl_feedback', 'blocker_rule', 'replay_validation', 'manual'], default: 'manual' })
  @IsOptional()
  @IsIn(['hitl_feedback', 'blocker_rule', 'replay_validation', 'manual'])
  source?: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  content!: string;

  @ApiProperty()
  @IsString()
  normalizedInstruction!: string;

  @ApiPropertyOptional({ enum: ['node', 'workflow', 'agent', 'workspace'], default: 'workflow' })
  @IsOptional()
  @IsIn(['node', 'workflow', 'agent', 'workspace'])
  appliesTo?: string;

  @ApiPropertyOptional({ enum: ['active', 'draft', 'archived'], default: 'draft' })
  @IsOptional()
  @IsIn(['active', 'draft', 'archived'])
  status?: string;

  @ApiPropertyOptional({ enum: ['normal', 'sensitive'], default: 'normal' })
  @IsOptional()
  @IsIn(['normal', 'sensitive'])
  sensitivity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdFromExecutionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdFromInterruptId?: string;
}

export class UpdateHitlMemoryDto extends PartialType(CreateHitlMemoryDto) {}

export class ResumeHitlInterruptDto {
  @ApiProperty({ enum: ['reply', 'approve', 'reject', 'skip', 'stop', 'review'] })
  @IsIn(['reply', 'approve', 'reject', 'skip', 'stop', 'review'])
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feedback?: string;

  @ApiPropertyOptional({ enum: HITL_FEEDBACK_SCOPES })
  @IsOptional()
  @IsIn(HITL_FEEDBACK_SCOPES)
  scope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remember?: boolean;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
