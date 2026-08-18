import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import playbookFlowConfig from '@config/playbook-flow.config';
import { ConflictException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { AnalyzeTaskOptimizationDto, AnalyzeWorkflowOptimizationDto, ContinuePlaybookClarificationDto, ListRecentExecutionsDto, RunPlaybookAssistantTurnDto, RunPlaybookFromStepDto, SearchPlaybooksDto, StartAdvisorRemediationConstructionDto, StartPlaybookAssistantConstructionDto, StartPlaybookGenerationDto } from '../dto/playbook-assistant.dto';
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
import { AgentService } from '@modules/agent/agent.service';
import { SECOND_BRAIN_AGENT_SLUG } from '@modules/agent/services/playbook-assistant-connector-reconciler.service';
import type { ExecutionDiagnosticCategory, ExecutionDiagnostics, MascotExecutionStatus } from '../interfaces/playbook-mascot.interface';
import { PlaybookAssistantRequestService } from './playbook-assistant-request.service';
import { PlaybookAssistantHistoryService } from './playbook-assistant-history.service';
import { PlaybookFlowIntentService } from '../services/playbook-flow-intent.service';
import { randomUUID } from 'crypto';
import { PlaybookAssistantAttachmentService } from './playbook-assistant-attachment.service';
import { ConversationService } from '@modules/conversation/services/conversation.service';
import { MessageService } from '@modules/conversation/services/message.service';

const DEFAULT_OPTIMIZATION_DIMENSIONS = ['clarity', 'agent', 'tools', 'inputs', 'outputs', 'bindings', 'cost', 'latency', 'determinism'];

export interface TrustedPlaybookAssistantActor {
  ownerId: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  correlationId: string;
}

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
    private readonly agentService: AgentService,
    private readonly requestService: PlaybookAssistantRequestService,
    private readonly historyService: PlaybookAssistantHistoryService,
    private readonly intentService: PlaybookFlowIntentService,
    private readonly attachmentService: PlaybookAssistantAttachmentService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  assertEnabled(): void {
    if (!this.config.mcpAssistantEnabled) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Playbook MCP assistant is disabled');
    }
  }

  async runTurn(playbookId: string, userId: string, dto: RunPlaybookAssistantTurnDto) {
    this.assertEnabled();
    const flow = await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    const definitionRevision = flow.definitionRevision ?? 0;
    this.assertRevision(definitionRevision, dto.expectedDefinitionRevision);
    const agentId = await this.agentService.findActiveDefaultAgentIdBySlug(SECOND_BRAIN_AGENT_SLUG);
    if (!agentId) {
      throw new ServiceUnavailableException(ErrorCode.AGENT_UNAVAILABLE, 'Yellowmind is unavailable');
    }
    const requestId = dto.requestId?.trim() || randomUUID();
    const continuationConversationId = dto.conversationId?.trim();
    if (dto.continuationId && !continuationConversationId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant clarification requires its conversation identifier');
    }
    const claimed = dto.continuationId
      ? {
          request: await this.requestService.getContinuationForUser(dto.continuationId, userId, playbookId, continuationConversationId!),
          replay: false,
        }
      : await (async () => {
          await this.attachmentService.assertBindings({
            ownerId: userId,
            playbookId,
            requestId,
            expectedDefinitionRevision: definitionRevision,
            attachmentIds: dto.attachmentIds ?? [],
          });
          return this.requestService.claimTurn({
            requestId,
            conversationId: dto.conversationId,
            ownerId: userId,
            tenantId: 'default',
            agentId,
            operationKind: 'existing_construction',
            playbookId,
            expectedDefinitionRevision: definitionRevision,
            text: dto.message,
            selectedTaskId: dto.selectedTaskId,
            executionId: dto.executionId,
            attachmentIds: dto.attachmentIds,
          });
        })();
    if ((!dto.continuationId && claimed.request.agentId !== agentId)
      || (continuationConversationId && claimed.request.conversationId !== continuationConversationId)) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant clarification conversation binding does not match');
    }
    if (claimed.replay) {
      const operation = claimed.request.mutationOperationId
        ? await this.constructionService.getStatus(playbookId, userId, claimed.request.mutationOperationId)
        : null;
      return {
        requestId: claimed.request.requestId,
        conversationId: claimed.request.conversationId,
        answer: claimed.request.assistantAnswer ?? 'The Playbook assistant completed the request.',
        assessment: claimed.request.assessment ?? null,
        operation: operation ? { ...operation, constructionId: operation.operationId } : null,
      };
    }
    await this.historyService.append({
      requestId: claimed.request.requestId,
      conversationId: claimed.request.conversationId,
      ownerId: userId,
      playbookId,
      role: 'user',
      content: dto.message.trim(),
    });
    try {
      const actor = this.actorFromRequest(claimed.request, userId);
      const assessment = (dto.continuationId
        ? await this.continueClarification(dto.continuationId, actor, { answers: dto.answers ?? [] })
        : await this.assessRequest(claimed.request.requestId, actor)) as Record<string, unknown> & { status?: string };
      let operation: (Awaited<ReturnType<PlaybookFlowIntentConstructionService['getStatus']>> & { constructionId: string }) | null = null;
      if (assessment.status !== 'needs_clarification') {
        const construction = await this.startBoundConstruction(claimed.request.requestId, actor, claimed.request.contextId);
        const status = await this.constructionService.getStatus(playbookId, userId, construction.operationId);
        operation = { ...status, constructionId: status.operationId };
      }
      const answer = assessment.status === 'needs_clarification'
        ? 'I need the requested details before constructing this Playbook change.'
        : 'The requested Playbook construction is ready in the canvas.';
      await this.requestService.complete(claimed.request.requestId, answer, operation?.operationId);
      await this.historyService.append({
        requestId: claimed.request.requestId,
        conversationId: claimed.request.conversationId,
        ownerId: userId,
        playbookId,
        role: 'assistant',
        content: answer,
        operationId: operation?.operationId,
      });
      return {
        requestId: claimed.request.requestId,
        conversationId: claimed.request.conversationId,
        answer,
        assessment,
        operation,
      };
    } catch (error) {
      await this.requestService.fail(claimed.request.requestId);
      throw error;
    }
  }

  async listHistory(playbookId: string, userId: string, conversationId?: string) {
    this.assertEnabled();
    await this.accessService.findAccessibleFlow(playbookId, userId, 'read');
    return this.historyService.list(userId, playbookId, conversationId);
  }

  async initializeAttachment(playbookId: string, userId: string, input: { requestId: string; expectedDefinitionRevision: number; mediaType: string; size: number }) {
    this.assertEnabled();
    const flow = await this.accessService.findAccessibleFlow(playbookId, userId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, input.expectedDefinitionRevision);
    return this.attachmentService.initialize({ ownerId: userId, playbookId, ...input });
  }

  confirmAttachment(playbookId: string, userId: string, attachmentId: string) {
    this.assertEnabled();
    return this.attachmentService.confirm(userId, playbookId, attachmentId);
  }

  async assessRequest(requestId: string, actor: TrustedPlaybookAssistantActor) {
    this.assertEnabled();
    const request = await this.requestService.getBound(requestId, actor);
    if (!request.playbookId || request.expectedDefinitionRevision == null) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Existing-Playbook assessment requires a bound Playbook revision');
    }
    const flow = await this.accessService.findAccessibleFlow(request.playbookId, request.ownerId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, request.expectedDefinitionRevision);
    const assessmentVersion = await this.requestService.claimAssessment(requestId);
    const assessment = await this.intentService.assessDesign(request.playbookId, request.ownerId, {
      intent: request.originalText,
      selectedTaskId: request.selectedTaskId ?? undefined,
      images: await this.attachmentService.resolveImages({
        ownerId: request.ownerId,
        playbookId: request.playbookId,
        requestId: request.requestId,
        expectedDefinitionRevision: request.expectedDefinitionRevision,
        attachmentIds: request.attachmentIds,
      }),
    });
    const normalized = this.normalizeAssessment(assessment as unknown as Record<string, unknown>);
    const saved = await this.requestService.saveAssessment(requestId, assessmentVersion, normalized);
    return {
      requestId,
      assessmentId: requestId,
      continuationId: saved.continuationId ?? null,
      definitionRevision: request.expectedDefinitionRevision,
      ...normalized,
    };
  }

  async continueClarification(continuationId: string, actor: TrustedPlaybookAssistantActor, dto: ContinuePlaybookClarificationDto) {
    this.assertEnabled();
    const request = await this.requestService.getByContinuation(continuationId, actor);
    if (!request.playbookId || request.expectedDefinitionRevision == null) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Clarification requires a bound Playbook revision');
    }
    const flow = await this.accessService.findAccessibleFlow(request.playbookId, request.ownerId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, request.expectedDefinitionRevision);
    const questions = Array.isArray(request.assessment?.questions)
      ? request.assessment.questions as Array<{ id?: string; required?: boolean }>
      : [];
    const allowedQuestionIds = new Set(questions.map((question) => question.id).filter((id): id is string => Boolean(id)));
    if (dto.answers.some((answer) => !allowedQuestionIds.has(answer.questionId))) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Clarification answer does not match the active assessment');
    }
    const answeredIds = new Set(dto.answers.map((answer) => answer.questionId));
    if (answeredIds.size !== dto.answers.length) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Clarification contains duplicate answers');
    }
    const meaningfulAnswerIds = new Set(dto.answers
      .filter((answer) => Boolean(answer.resource || answer.choice?.trim() || answer.text?.trim()))
      .map((answer) => answer.questionId));
    if (questions.some((question) => question.required && question.id && !meaningfulAnswerIds.has(question.id))) {
      throw new ConflictException(ErrorCode.CONFLICT, 'A required clarification answer is missing');
    }
    const normalized = {
      ...(request.assessment ?? {}),
      status: 'ready_to_construct',
    };
    await this.requestService.claimContinuation({
      requestId: request.requestId,
      continuationId,
      actor,
      answers: dto.answers as unknown as Record<string, unknown>[],
      assessment: normalized,
    });
    return {
      requestId: request.requestId,
      assessmentId: request.requestId,
      continuationId: null,
      definitionRevision: request.expectedDefinitionRevision,
      ...normalized,
    };
  }

  async startBoundConstruction(requestId: string, actor: TrustedPlaybookAssistantActor, contextId?: string) {
    this.assertEnabled();
    const request = await this.requestService.getBound(requestId, actor);
    if (!request.playbookId || request.expectedDefinitionRevision == null) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Construction requires a bound Playbook revision');
    }
    if (request.operationKind !== 'existing_construction' || request.status !== 'ready') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is not ready for construction');
    }
    if (contextId && contextId !== request.contextId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant context binding does not match');
    }
    const flow = await this.accessService.findAccessibleFlow(request.playbookId, request.ownerId, 'write');
    this.assertRevision(flow.definitionRevision ?? 0, request.expectedDefinitionRevision);
    const proposedOperationId = randomUUID();
    const operationId = await this.requestService.claimMutation(request.requestId, proposedOperationId);
    if (operationId !== proposedOperationId) {
      const status = await this.constructionService.getStatus(request.playbookId, request.ownerId, operationId);
      return this.withEventStreamPath({
        constructionId: status.operationId,
        playbookId: status.playbookId,
        baseDefinitionRevision: status.baseDefinitionRevision,
      });
    }
    try {
      const result = await this.constructionService.start(
        request.playbookId,
        request.ownerId,
        {
          intent: this.buildConstructionIntent(request),
          selectedTaskId: request.selectedTaskId ?? undefined,
          images: await this.attachmentService.resolveImages({
            ownerId: request.ownerId,
            playbookId: request.playbookId,
            requestId: request.requestId,
            expectedDefinitionRevision: request.expectedDefinitionRevision,
            attachmentIds: request.attachmentIds,
          }),
        },
        { origin: 'mcp', operationId, requestId: request.requestId, operationKind: 'construction' },
      );
      return this.withEventStreamPath(result);
    } catch (error) {
      await this.requestService.releaseMutation(request.requestId, operationId);
      throw error;
    }
  }

  async startGeneration(requestId: string, actor: TrustedPlaybookAssistantActor, dto: StartPlaybookGenerationDto): Promise<{
    operationId: string;
    constructionId: string;
    playbookId: string;
    baseDefinitionRevision: number;
    status: 'planning';
    eventStreamPath: string;
  }> {
    this.assertEnabled();
    const request = await this.requestService.getBound(requestId, actor);
    if (request.operationKind !== 'generation') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant request is not bound to generation');
    }
    const proposedOperationId = randomUUID();
    const operationId = await this.requestService.claimMutation(request.requestId, proposedOperationId);
    if (operationId !== proposedOperationId) {
      const existingFlow = await this.flowService.findByAssistantOperationId(request.ownerId, operationId);
      if (!existingFlow) throw new ConflictException(ErrorCode.CONFLICT, 'Generation operation is not ready');
      const status = await this.constructionService.getStatus(existingFlow.id, request.ownerId, operationId);
      if (status.status === 'failed' || status.status === 'cancelled') {
        const removed = await this.flowService.removeAssistantDraftIfUnchanged(
          request.ownerId,
          existingFlow.id,
          operationId,
          status.baseDefinitionRevision,
        );
        if (!removed) {
          throw new ConflictException(ErrorCode.CONFLICT, 'The generated Playbook changed and cannot be replaced automatically');
        }
        const reset = await this.requestService.resetMutation(request.requestId, operationId);
        if (!reset) {
          throw new ConflictException(ErrorCode.CONFLICT, 'Generation retry is already being claimed');
        }
        return this.startGeneration(requestId, actor, dto);
      }
      return this.withEventStreamPath({
        constructionId: status.operationId,
        playbookId: status.playbookId,
        baseDefinitionRevision: status.baseDefinitionRevision,
      });
    }
    let playbookId: string | null = null;
    let baseDefinitionRevision = 0;
    try {
      const fallbackName = request.originalText.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New Playbook';
      const requestedName = dto.name?.trim() || fallbackName;
      const flow = await this.flowService.create(request.ownerId, {
        name: requestedName.length >= 2 ? requestedName : 'New Playbook',
        description: request.originalText,
        workspaces: [],
      }, { assistantOperationId: operationId });
      playbookId = flow.id;
      baseDefinitionRevision = flow.definitionRevision ?? 0;
      await this.requestService.bindGeneratedPlaybook(request.requestId, playbookId, baseDefinitionRevision);
      const result = await this.constructionService.start(
        playbookId,
        request.ownerId,
        { intent: request.originalText },
        {
          origin: 'mcp',
          operationId,
          requestId: request.requestId,
          operationKind: 'generation',
          createdPlaybookId: playbookId,
        },
      );
      return this.withEventStreamPath(result);
    } catch (error) {
      if (playbookId) {
        const removed = await this.flowService.removeAssistantDraftIfUnchanged(request.ownerId, playbookId, operationId, baseDefinitionRevision);
        if (!removed) {
          throw new ConflictException(ErrorCode.CONFLICT, 'The generated Playbook changed and cannot be removed automatically');
        }
      }
      await this.requestService.resetMutation(request.requestId, operationId);
      throw error;
    }
  }

  async startCurrentTurnGeneration(actor: TrustedPlaybookAssistantActor, dto: StartPlaybookGenerationDto) {
    this.assertEnabled();
    const conversation = await this.conversationService.getConversationDocument(actor.conversationId);
    if (conversation.createdBy.toString() !== actor.ownerId
      || conversation.runtimePurpose !== 'platform_copilot'
      || conversation.pinnedAgentId?.toString() !== actor.agentId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant generation conversation binding does not match');
    }
    const response = await this.messageService.getMessageDocument(actor.correlationId);
    if (response.conversationId.toString() !== actor.conversationId
      || response.conversationType !== 'ai'
      || response.senderId?.toString() !== actor.ownerId
      || !response.questionMessageId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant generation response binding does not match');
    }
    const question = await this.messageService.getMessageDocument(response.questionMessageId.toString());
    if (question.conversationId.toString() !== actor.conversationId
      || question.conversationType !== 'user'
      || question.senderId?.toString() !== actor.ownerId
      || !question.content?.trim()) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant generation question binding does not match');
    }
    const request = await this.requestService.claimGenerationForTurn({ actor, text: question.content });
    return this.startGeneration(request.requestId, actor, dto);
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

  async searchPlaybooks(userId: string, dto: SearchPlaybooksDto) {
    this.assertEnabled();
    const limit = Math.min(Math.max(dto.limit ?? 10, 1), 25);
    const items = await this.flowService.searchForAssistant(userId, dto.query, dto.workspaceId, limit);
    return {
      items: items.map((item) => ({
        ...item,
        status: 'active' as const,
        uiTarget: {
          surface: 'playbook.editor' as const,
          params: { playbookId: item.playbookId },
        },
      })),
      count: items.length,
      hasMore: items.length === limit,
    };
  }

  async listRecentExecutions(userId: string, dto: ListRecentExecutionsDto) {
    this.assertEnabled();
    const flowIndex = await this.flowService.findAccessibleAssistantIndex(userId);
    const flowById = new Map(flowIndex.map((flow) => [flow.playbookId, flow]));
    const statuses = dto.status === 'waiting'
      ? ['queued', 'pending_approval']
      : dto.status ? [dto.status] : undefined;
    const executions = await this.executionService.findRecentByAccessibleFlowIds(
      flowIndex.map((flow) => flow.playbookId),
      statuses,
      Math.min(Math.max(dto.limit ?? 10, 1), 25),
    );
    return {
      items: executions.map((execution) => {
        const flow = flowById.get(execution.flowId);
        const taskName = execution.task
          ? flow?.tasks.find((task) => task.taskId === execution.task?.taskId)?.taskName ?? execution.task.taskName ?? execution.task.taskId
          : undefined;
        return {
          playbookId: execution.flowId,
          playbookName: flow?.name ?? 'Playbook',
          executionId: execution.executionId,
          status: this.normalizeExecutionStatus(execution.status, execution.waitingForHumanInput),
          startedAt: execution.startedAt,
          updatedAt: execution.updatedAt,
          endedAt: execution.endedAt,
          ...(execution.task ? {
            task: { ...execution.task, taskName },
          } : {}),
          uiTarget: {
            surface: execution.task?.status === 'failed' ? 'playbook.execution.task' as const : 'playbook.execution.details' as const,
            params: {
              playbookId: execution.flowId,
              executionId: execution.executionId,
              ...(execution.task?.status === 'failed' ? { taskId: execution.task.taskId } : {}),
            },
            ...(execution.task?.status === 'failed' ? { effects: [{ type: 'highlightTask' as const, taskId: execution.task.taskId }] } : {}),
          },
        };
      }),
    };
  }

  async getExecutionDiagnostics(executionId: string, userId: string): Promise<ExecutionDiagnostics> {
    this.assertEnabled();
    const execution = await this.executionService.findOne(executionId, userId);
    const flow = await this.flowService.findOneBase(execution.flowId, userId);
    const failedTask = execution.taskResults.find((task) => task.status === 'failed');
    const waitingForHuman = execution.status === 'pending_approval' || Boolean(execution.pendingApproval);
    const rawError = failedTask?.error || execution.error || '';
    const category = waitingForHuman ? 'human_input_required' : this.diagnosticCategory(rawError);
    const status = this.normalizeExecutionStatus(execution.status, waitingForHuman);
    const taskName = failedTask
      ? flow.nodes?.find((node) => node.id === failedTask.taskId)?.label ?? failedTask.generatedNodeTitle ?? failedTask.taskId
      : undefined;
    const uiTarget = failedTask
      ? {
        surface: 'playbook.execution.task' as const,
        params: { playbookId: execution.flowId, executionId, taskId: failedTask.taskId },
        effects: [{ type: 'highlightTask' as const, taskId: failedTask.taskId }],
      }
      : {
        surface: 'playbook.execution.details' as const,
        params: { playbookId: execution.flowId, executionId },
        effects: [{ type: 'focusExecutionStatus' as const }],
      };
    return {
      executionId,
      playbookId: execution.flowId,
      status,
      summary: this.diagnosticSummary(status, category, taskName),
      ...(failedTask ? {
        failedTask: {
          taskId: failedTask.taskId,
          taskName: taskName ?? failedTask.taskId,
          iteration: failedTask.iteration,
        },
      } : {}),
      ...(category ? {
        cause: {
          code: this.diagnosticCode(category),
          category,
          message: this.diagnosticMessage(category),
          retryable: ['tool_error', 'model_error', 'timeout', 'unknown'].includes(category),
        },
      } : {}),
      missingInputs: [],
      recommendedNextActions: waitingForHuman
        ? [{ type: 'wait_for_human', label: 'Open the execution to provide the required human input.' }]
        : failedTask
          ? [{ type: 'open_task', label: 'Open the failed task.' }]
          : [{ type: 'open_execution', label: 'Open the execution details.' }],
      uiTarget,
    };
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

  private normalizeExecutionStatus(status: string, waitingForHuman = false): MascotExecutionStatus {
    if (waitingForHuman || status === 'queued' || status === 'pending_approval') return 'waiting';
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
    return 'running';
  }

  private diagnosticCategory(error: string): ExecutionDiagnosticCategory {
    const normalized = error.toLowerCase();
    if (/missing|required input|input.*required/.test(normalized)) return 'missing_input';
    if (/binding|mapping|source port|target port/.test(normalized)) return 'invalid_binding';
    if (/permission|forbidden|unauthori[sz]ed|access denied/.test(normalized)) return 'permission';
    if (/timeout|timed out|deadline/.test(normalized)) return 'timeout';
    if (/model|llm|provider|completion/.test(normalized)) return 'model_error';
    if (/tool|connector|mcp/.test(normalized)) return 'tool_error';
    return 'unknown';
  }

  private diagnosticCode(category: ExecutionDiagnosticCategory): string {
    return `PLAYBOOK_EXECUTION_${category.toUpperCase()}`;
  }

  private diagnosticMessage(category: ExecutionDiagnosticCategory): string {
    const messages: Record<ExecutionDiagnosticCategory, string> = {
      missing_input: 'The execution is missing a required input.',
      invalid_binding: 'A task input binding is invalid or unavailable.',
      tool_error: 'A Playbook tool failed while running the task.',
      model_error: 'The model provider could not complete the task.',
      timeout: 'The task exceeded its execution deadline.',
      permission: 'The acting user does not have permission for a required operation.',
      human_input_required: 'The execution is waiting for human input in the Playbook runtime.',
      unknown: 'The execution failed for an unclassified reason. Open the execution for details.',
    };
    return messages[category];
  }

  private diagnosticSummary(status: MascotExecutionStatus, category: ExecutionDiagnosticCategory, taskName?: string): string {
    if (category === 'human_input_required') return 'The execution is waiting for human input.';
    if (status === 'completed') return 'The execution completed successfully.';
    if (status === 'running' || status === 'waiting') return 'The execution has not reached a terminal state.';
    if (status === 'cancelled') return 'The execution was cancelled.';
    return taskName ? `The execution failed in task "${taskName}".` : 'The execution failed.';
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

  private normalizeAssessment(assessment: Record<string, unknown>): Record<string, unknown> {
    const { lastTrace: _lastTrace, ...safeAssessment } = assessment;
    return {
      ...safeAssessment,
      status: assessment.status === 'ready_to_generate' ? 'ready_to_construct' : assessment.status,
    };
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

  private actorFromRequest(request: {
    tenantId: string;
    agentId: string;
    conversationId: string;
    correlationId: string;
  }, ownerId: string): TrustedPlaybookAssistantActor {
    return {
      ownerId,
      tenantId: request.tenantId,
      agentId: request.agentId,
      conversationId: request.conversationId,
      correlationId: request.correlationId,
    };
  }

  private buildConstructionIntent(request: {
    originalText: string;
    assessment?: Record<string, unknown> | null;
    answers: Record<string, unknown>[];
  }): string {
    return [
      '<original_request>',
      request.originalText,
      '</original_request>',
      '<resolved_design_context>',
      JSON.stringify({
        assessment: request.assessment ?? null,
        clarificationAnswers: request.answers ?? [],
      }),
      '</resolved_design_context>',
      'Treat the resolved design context as binding. Do not replace selected sources, outputs, resources, or branching decisions.',
    ].join('\n');
  }
}
