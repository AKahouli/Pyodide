import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConflictException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AnalyzeTaskOptimizationDto, AnalyzeWorkflowOptimizationDto, RunPlaybookFromStepDto, StartAdvisorRemediationConstructionDto, StartPlaybookAssistantConstructionDto } from '../dto/playbook-assistant.dto';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { StartPlaybookFlowExecutionDto } from '../dto/start-playbook-flow-execution.dto';
import type { PlaybookTaskOptimizationResult } from '../interfaces/playbook-assistant.interface';
import { FlowAccessService } from '../domain/flow-access.service';
import { PlaybookFlowExecutionAdvisorService } from '../services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowIntentConstructionService } from '../services/playbook-flow-intent-construction.service';
import type { PlaybookIntentConstructionEvent } from '../interfaces/playbook-flow-intent-construction.interface';
import { PlaybookAssistantContextService } from './playbook-assistant-context.service';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowExecutionService } from '../services/playbook-flow-execution.service';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';

const DEFAULT_OPTIMIZATION_DIMENSIONS = ['clarity', 'agent', 'tools', 'inputs', 'outputs', 'bindings', 'cost', 'latency', 'determinism'];

@Injectable()
export class PlaybookAssistantService {
  constructor(
    @Inject(playbookFlowConfig.KEY) private readonly config: ConfigType<typeof playbookFlowConfig>,
    private readonly contextService: PlaybookAssistantContextService,
    private readonly accessService: FlowAccessService,
    private readonly constructionService: PlaybookFlowIntentConstructionService,
    private readonly advisorService: PlaybookFlowExecutionAdvisorService,
    private readonly flowService: PlaybookFlowService,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly replayService: PlaybookFlowReplayService,
  ) {}

  assertEnabled(): void {
    if (!this.config.mcpAssistantEnabled) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Playbook MCP assistant is disabled');
    }
  }

  async startConstruction(playbookId: string, userId: string, dto: StartPlaybookAssistantConstructionDto) {
    this.assertEnabled();
    const flow = await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, dto.expectedDefinitionRevision);
    const result = await this.constructionService.start(playbookId, userId, dto, { origin: 'mcp' });
    return this.withEventStreamPath(result);
  }

  getConstruction(playbookId: string, userId: string, constructionId: string) {
    this.assertEnabled();
    return this.constructionService.getStatus(playbookId, userId, constructionId);
  }

  streamConstruction(playbookId: string, userId: string, constructionId: string, afterSequence: number): AsyncGenerator<PlaybookIntentConstructionEvent> {
    this.assertEnabled();
    return this.constructionService.stream(playbookId, userId, constructionId, afterSequence);
  }

  async cancelConstruction(playbookId: string, userId: string, constructionId: string, reason?: string) {
    this.assertEnabled();
    await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    return this.constructionService.cancel(playbookId, userId, constructionId, reason);
  }

  async revertConstruction(playbookId: string, userId: string, constructionId: string) {
    this.assertEnabled();
    await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    return this.constructionService.revert(playbookId, userId, constructionId);
  }

  async analyzeTaskOptimization(
    playbookId: string,
    taskId: string,
    userId: string,
    dto: AnalyzeTaskOptimizationDto,
  ): Promise<PlaybookTaskOptimizationResult> {
    this.assertEnabled();
    const context = await this.contextService.open(playbookId, userId, { selectedTaskId: taskId, executionId: dto.executionId });
    const task = context.selectedTask!;
    const dimensions = dto.dimensions?.length ? dto.dimensions : DEFAULT_OPTIMIZATION_DIMENSIONS;
    const findings: PlaybookTaskOptimizationResult['findings'] = [];
    if (dimensions.includes('clarity') && !(task.description ?? '').trim()) {
      findings.push({ dimension: 'clarity', severity: 'warning', message: 'The task has no design-time description.' });
    }
    if (dimensions.includes('bindings')) {
      const relatedDiagnostics = context.validation.diagnostics.filter((diagnostic) => diagnostic.message.includes(taskId));
      findings.push(...relatedDiagnostics.map((diagnostic) => ({ dimension: 'bindings', severity: 'warning' as const, message: diagnostic.message })));
    }
    if (findings.length === 0) {
      findings.push({ dimension: 'clarity', severity: 'info', message: 'No deterministic design-time issue was detected for the requested dimensions.' });
    }
    const remediationItems = dto.executionId
      ? await this.advisorService.getRemediations(dto.executionId, userId, taskId)
      : [];
    return {
      playbookId,
      taskId,
      definitionRevision: context.definitionRevision,
      dimensions,
      findings,
      evidence: { validationDiagnostics: context.validation.diagnostics, remediationItems },
      mutationApplied: false,
    };
  }

  async startAdvisorRemediationConstruction(
    playbookId: string,
    userId: string,
    dto: StartAdvisorRemediationConstructionDto,
  ) {
    this.assertEnabled();
    const flow = await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, dto.expectedDefinitionRevision);
    const preview = await this.advisorService.previewRemediation(playbookId, userId, {
      executionId: dto.executionId,
      mode: dto.mode,
      targetTaskId: dto.selectedTaskId,
      items: dto.items,
    });
    this.assertRevision(flow.definitionRevision ?? 0, preview.expectedDefinitionRevision);
    const result = await this.constructionService.startPrepared({
      flowId: playbookId,
      ownerId: userId,
      baseDefinitionRevision: preview.expectedDefinitionRevision,
      suggestions: [preview.suggestion],
      applyTarget: dto.mode === 'generate-new' ? 'new_playbook' : 'current_playbook',
    });
    return {
      ...this.withEventStreamPath(result),
      origin: 'advisor' as const,
      target: 'advisor_preview' as const,
      applyTarget: dto.mode === 'generate-new' ? 'new-playbook' as const : 'current-playbook' as const,
    };
  }

  async analyzeWorkflowOptimization(playbookId: string, userId: string, dto: AnalyzeWorkflowOptimizationDto) {
    this.assertEnabled();
    const context = await this.contextService.open(playbookId, userId, { executionId: dto.executionId });
    return {
      playbookId,
      definitionRevision: context.definitionRevision,
      dimensions: dto.dimensions?.length ? dto.dimensions : DEFAULT_OPTIMIZATION_DIMENSIONS,
      workflow: context.workflow,
      validation: context.validation,
      execution: context.execution,
      mutationApplied: false as const,
    };
  }

  async createPlaybook(userId: string, dto: CreatePlaybookFlowDto) {
    this.assertEnabled();
    return this.flowService.create(userId, dto);
  }

  async clonePlaybook(playbookId: string, userId: string) {
    this.assertEnabled();
    return this.flowService.clone(playbookId, userId);
  }

  async startExecution(playbookId: string, userId: string, dto: StartPlaybookFlowExecutionDto, idempotencyKey?: string) {
    this.assertEnabled();
    const execution = await this.executionService.start(
      playbookId,
      userId,
      dto.inputContext,
      idempotencyKey,
      dto.singleStepTaskId,
      dto.advisorAutopilotEnabled,
      dto.advisorAutopilotTargetScore,
      dto.advisorAutopilotMaxTurns,
      dto.reflectionEnabled,
      dto.advisorScoringMode,
      dto.executionMode,
      dto.stepExecutionModes,
      dto.modelIdOverride,
    );
    return { executionId: this.executionId(execution) };
  }

  listExecutions(playbookId: string, userId: string, page = 1, limit = 10) {
    this.assertEnabled();
    return this.executionService.findAll(playbookId, userId, page, Math.min(limit, 50));
  }

  async getExecution(executionId: string, userId: string) {
    this.assertEnabled();
    const execution = await this.executionService.findOne(executionId, userId);
    return this.withHitlStatus(execution);
  }

  cancelExecution(executionId: string, userId: string) {
    this.assertEnabled();
    return this.executionService.cancel(executionId, userId);
  }

  traceReplayExecution(executionId: string, userId: string) {
    this.assertEnabled();
    return this.replayService.traceReplay(executionId, userId);
  }

  reExecute(executionId: string, userId: string) {
    this.assertEnabled();
    return this.replayService.reExecute(executionId, userId);
  }

  async runFromStep(executionId: string, userId: string, dto: RunPlaybookFromStepDto) {
    this.assertEnabled();
    const execution = await this.executionService.runFromStep(executionId, userId, dto);
    return { executionId: this.executionId(execution) };
  }

  async deleteExecution(executionId: string, userId: string) {
    this.assertEnabled();
    await this.executionService.delete(executionId, userId);
    return { deleted: true };
  }

  private executionId(execution: unknown): string {
    if (execution && typeof execution === 'object') {
      const record = execution as { id?: unknown; _id?: unknown };
      if (typeof record.id === 'string') return record.id;
      if (record._id != null) return String(record._id);
    }
    throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Execution identifier is unavailable');
  }

  private withHitlStatus<T>(execution: T): T & { assistantStatus?: 'runtime_hitl_required'; message?: string } {
    if (execution && typeof execution === 'object' && (execution as { waitingForHumanInput?: boolean }).waitingForHumanInput === true) {
      return Object.assign(execution, {
        assistantStatus: 'runtime_hitl_required' as const,
        message: 'Continue in the existing Playbook runtime HITL panel.',
      });
    }
    return execution as T & { assistantStatus?: 'runtime_hitl_required'; message?: string };
  }

  private assertRevision(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new ConflictException(ErrorCode.CONFLICT, 'The Playbook changed after the assistant context was opened.');
    }
  }

  private withEventStreamPath<T extends { constructionId: string; playbookId: string; baseDefinitionRevision: number }>(result: T) {
    return {
      operationId: result.constructionId,
      constructionId: result.constructionId,
      playbookId: result.playbookId,
      baseDefinitionRevision: result.baseDefinitionRevision,
      status: 'planning' as const,
      eventStreamPath: `/api/v1/playbooks/${encodeURIComponent(result.playbookId)}/intent-constructions/${encodeURIComponent(result.constructionId)}/stream`,
    };
  }
}
