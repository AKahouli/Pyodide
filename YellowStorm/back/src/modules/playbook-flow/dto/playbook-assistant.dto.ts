import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Stable idempotency identifier for this assistant turn.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  requestId?: string;

  @ApiPropertyOptional({ description: 'Server-issued conversation identifier from a prior turn.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  conversationId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Confirmed opaque assistant attachment identifiers.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  attachmentIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  continuationId?: string;

  @ApiPropertyOptional({ type: () => [PlaybookClarificationAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookClarificationAnswerDto)
  answers?: PlaybookClarificationAnswerDto[];
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

export class PlaybookClarificationResourceDto {
  @ApiProperty({ enum: ['workspace', 'document'] })
  @IsIn(['workspace', 'document'])
  kind!: 'workspace' | 'document';

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  id!: string;
}

/** The workspaces and files the person chose for one source question, or that they skip it. */
export class ChoosePlaybookClarificationSourcesDto {
  @ApiPropertyOptional({ type: [PlaybookClarificationResourceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookClarificationResourceDto)
  resources?: PlaybookClarificationResourceDto[];

  @ApiPropertyOptional({ description: 'One of the question\'s own answers that is not a workspace or a file.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  choice?: string;

  @ApiPropertyOptional({ description: 'Skip this question: the playbook asks for it when it runs.' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

export class PlaybookClarificationAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  questionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  choice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;

  @ApiPropertyOptional({ type: PlaybookClarificationResourceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlaybookClarificationResourceDto)
  resource?: PlaybookClarificationResourceDto;
}

export class ContinuePlaybookClarificationDto {
  @ApiProperty({ type: [PlaybookClarificationAnswerDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookClarificationAnswerDto)
  answers!: PlaybookClarificationAnswerDto[];

  @ApiPropertyOptional({ description: 'Skip the remaining clarification questions and build with the collected answers only.' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

export class StartBoundPlaybookConstructionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contextId?: string;
}

export class InitializePlaybookAssistantAttachmentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  requestId!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  expectedDefinitionRevision!: number;

  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] })
  @IsIn(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  mediaType!: string;

  @ApiProperty({ maximum: 1500000 })
  @IsInt()
  @Min(1)
  @Max(1500000)
  size!: number;
}

export class StartPlaybookGenerationDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  continuationId?: string;

  @ApiPropertyOptional({ type: [PlaybookClarificationAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookClarificationAnswerDto)
  answers?: PlaybookClarificationAnswerDto[];

  @ApiPropertyOptional({ description: 'Skip the remaining clarification questions and generate with the collected answers only.' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

export class RunCurrentTurnPlaybookModificationDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  continuationId?: string;

  @ApiPropertyOptional({ type: [PlaybookClarificationAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlaybookClarificationAnswerDto)
  answers?: PlaybookClarificationAnswerDto[];

  @ApiPropertyOptional({ description: 'Skip the remaining clarification questions and build with the collected answers only.' })
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}
