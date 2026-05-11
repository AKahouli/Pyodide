import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  ExecutionStatus,
  StepStatus,
  JudgeStatus,
} from '../schemas/playbook-execution.schema';
import { PlaybookService } from './playbook.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookContextService } from './playbook-context.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { ExecutePlaybookDto } from '../dto/execute-playbook.dto';
import { ResumePlaybookDto } from '../dto/resume-playbook.dto';
import { LoggerService } from '../../logger';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentService } from '../../agent/agent.service';
import { IGrpcAgent } from '../../agent/interfaces/agent.interface';
import { ModelsService } from '../../models/models.service';
import { UsageService } from '../../usage/usage.service';
import { UsageType } from '../../usage/schemas/usage.schema';
import { EmailService } from '../../email/email.service';
import { UserService } from '../../user/user.service';
import { PlaybookReplayService } from './playbook-replay.service';
import { PlaybookOutputFormatService } from './playbook-output-format.service';
import { PlaybookPromptService } from './playbook-prompt.service';
import { PlaybookSemanticEnrichmentService } from './playbook-semantic-enrichment.service';
import { PlaybookJudgeEnrichmentService } from './playbook-judge-enrichment.service';
import { Connector, ConnectorDocument } from '../../connector/schemas/connector.schema';
import type { ConnectorAuthService } from '../../connector/interfaces/connector-auth.interface';
import {
  extractTextFromComponents,
  mapGrpcComponents,
  pLimit,
  topologicalSortByLevel,
  mergeWithExistingHumanFeedback,
  extractArtifactsFromResult,
  mapGrpcIteratorIterations,
  mapGrpcPortPayloads,
  mapGrpcTaskArtifacts,
  TaskArtifactEntry,
  MAX_COMPONENTS_PER_TASK_DEFAULT,
  MAX_CONCURRENT_STEPS_DEFAULT,
} from '../utils/execution.utils';
import type { BufferedStepResult } from '../utils/execution.utils';
import { PlaybookExecutionGraphService } from './playbook-execution-graph.service';
import { PlaybookExecutionNotificationService } from './playbook-execution-notification.service';
import { PlaybookExecutionBufferService } from './playbook-execution-buffer.service';
import { PlaybookExecutionAdvisorService } from './playbook-execution-advisor.service';
import { PlaybookEvaluationService } from './playbook-evaluation.service';

const SKIP_STEP_REASON = '__SKIP_STEP__';

interface AdvisorAutopilotConfig {
  enabled: boolean;
  targetScore: number;
  maxTurns: number;
}

type AdvisorAutopilotStopReason =
  | 'target_reached'
  | 'max_turns_reached'
  | 'advisor_abstained'
  | 'no_safe_fix_available'
  | 'advisor_evaluation_failed';

@Injectable()
export class PlaybookExecutionService {
  private readonly maxComponentsPerTask: number;
  private readonly maxConcurrentSteps: number;

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(Connector.name)
    private readonly connectorModel: Model<ConnectorDocument>,
    private readonly playbookService: PlaybookService,
    private readonly grpcService: PlaybookGrpcService,
    private readonly contextService: PlaybookContextService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly usageService: UsageService,
    private readonly emailService: EmailService,
    private readonly userService: UserService,
    private readonly replayService: PlaybookReplayService,
    private readonly outputFormatService: PlaybookOutputFormatService,
    private readonly promptService: PlaybookPromptService,
    private readonly semanticEnrichmentService: PlaybookSemanticEnrichmentService,
    private readonly judgeEnrichmentService: PlaybookJudgeEnrichmentService,
    @Inject('ConnectorAuthService')
    private readonly connectorAuthService: ConnectorAuthService,
    private readonly advisorService: PlaybookExecutionAdvisorService,
    private readonly evaluationService: PlaybookEvaluationService,
    private readonly graphService: PlaybookExecutionGraphService,
    private readonly notificationService: PlaybookExecutionNotificationService,
    private readonly bufferService: PlaybookExecutionBufferService,
  ) {
    this.logger.setContext('PlaybookExecutionService');
    this.maxComponentsPerTask =
      this.configService.get<number>('playbook.maxComponentsPerTask') ||
      MAX_COMPONENTS_PER_TASK_DEFAULT;
    this.maxConcurrentSteps =
      this.configService.get<number>('playbook.maxConcurrentSteps') || MAX_CONCURRENT_STEPS_DEFAULT;
    this.portUnificationV2Enabled =
      this.configService.get<boolean>('playbook.portUnification.v2') ?? true;
  }

  private readonly portUnificationV2Enabled: boolean;

  private normalizeStructLike(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeStructLike(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if ('stringValue' in value) return value.stringValue;
    if ('numberValue' in value) return value.numberValue;
    if ('boolValue' in value) return value.boolValue;
    if ('nullValue' in value) return null;
    if ('listValue' in value) {
      const list = value.listValue?.values || value.listValue || [];
      return Array.isArray(list) ? list.map((item: any) => this.normalizeStructLike(item)) : [];
    }
    if ('structValue' in value) {
      return this.normalizeStructLike(value.structValue);
    }
    if ('fields' in value && Object.keys(value).length === 1) {
      return Object.entries(value.fields || {}).reduce<Record<string, unknown>>(
        (acc, [key, fieldValue]) => {
          acc[key] = this.normalizeStructLike(fieldValue);
          return acc;
        },
        {},
      );
    }

    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
      acc[key] = this.normalizeStructLike(nestedValue);
      return acc;
    }, {});
  }

  private toGrpcStructValue(value: any): any {
    if (value === null || value === undefined) {
      return { nullValue: 'NULL_VALUE', kind: 'nullValue' };
    }
    if (Array.isArray(value)) {
      return {
        listValue: {
          values: value.map((item) => this.toGrpcStructValue(item)),
        },
        kind: 'listValue',
      };
    }
    if (typeof value === 'string') {
      return { stringValue: value, kind: 'stringValue' };
    }
    if (typeof value === 'number') {
      return { numberValue: value, kind: 'numberValue' };
    }
    if (typeof value === 'boolean') {
      return { boolValue: value, kind: 'boolValue' };
    }
    if (typeof value === 'object') {
      return {
        structValue: this.toGrpcStruct(value),
        kind: 'structValue',
      };
    }
    return { stringValue: String(value), kind: 'stringValue' };
  }

  private toGrpcStruct(value: Record<string, unknown>): any {
    return {
      fields: Object.entries(value || {}).reduce<Record<string, unknown>>(
        (acc, [key, nestedValue]) => {
          acc[key] = this.toGrpcStructValue(nestedValue);
          return acc;
        },
        {},
      ),
    };
  }

  private async buildGrpcToolBindings(
    bindings: any[],
    agentConnectorIds?: string[],
    userId?: string,
  ): Promise<any[]> {
    const enabledBindings = (bindings || []).filter((b: any) => b?.isEnabled !== false);
    if (enabledBindings.length === 0 && (!agentConnectorIds || agentConnectorIds.length === 0)) {
      return [];
    }

    const stepConnectorIds = Array.from(
      new Set(
        enabledBindings
          .map((binding: any) => binding?.connectorId)
          .filter((id: any) => Types.ObjectId.isValid(id)),
      ),
    ).map((id) => new Types.ObjectId(id));

    const agentConnIds = agentConnectorIds || [];
    for (const cid of agentConnIds) {
      if (Types.ObjectId.isValid(cid) && !stepConnectorIds.some((id) => id.toString() === cid)) {
        stepConnectorIds.push(new Types.ObjectId(cid));
      }
    }

    const allConnectorIds = stepConnectorIds;
    if (allConnectorIds.length === 0) {
      return [];
    }

    const connectors = await this.connectorModel
      .find({ _id: { $in: allConnectorIds } })
      .lean()
      .exec();
    const connectorMap = new Map<string, any>(connectors.map((c: any) => [c._id.toString(), c]));

    this.logger.debug('buildGrpcToolBindings inputs', {
      enabledStepBindings: enabledBindings.length,
      agentConnectorIds: agentConnIds,
      connectorsFound: connectors.length,
      connectorIds: allConnectorIds.map((id) => id.toString()),
    });

    const stepConnectorIdSet = new Set(enabledBindings.map((binding: any) => binding.connectorId));
    const allBindings = [...enabledBindings];

    for (const cid of agentConnIds) {
      if (!Types.ObjectId.isValid(cid)) continue;
      if (stepConnectorIdSet.has(cid)) continue;

      const connector = connectorMap.get(cid);
      if (!connector) {
        this.logger.warn('Agent connector not found in DB', { connectorId: cid });
        continue;
      }

      const connActions = (connector.actions || []).filter(
        (action: any) => action.isEnabled !== false,
      );
      if (connActions.length === 0) {
        this.logger.warn('Agent connector has no enabled actions', {
          connectorId: cid,
          connectorName: connector.name,
        });
        continue;
      }

      allBindings.push({
        id: `agent_${cid}`,
        connector_id: cid,
        connector_name: connector?.name || cid,
        actions: connActions.map((action: any) => ({
          action_key: action.key,
          label: action.label || action.key,
          description: action.description || '',
          parameter_schema: this.toGrpcStruct(action.parameterSchema || {}),
          parameter_schema_json: JSON.stringify(action.parameterSchema || {}),
        })),
        credential_id: null,
        fixed_params: {},
        disable_auto_skills: false,
        mcp_transport_type: connector?.mcpTransportType || '',
        mcp_server_url: connector?.mcpServerUrl || '',
        mcp_server_config: this.toGrpcStruct(connector?.mcpServerConfig || {}),
        auth_headers: {} as Record<string, string>,
        auth_env: {} as Record<string, string>,
      });
    }

    const result = allBindings.map((binding: any) => {
      const connector = connectorMap.get(binding.connector_id || binding.connectorId);
      const connectorActions = new Map<string, any>(
        ((connector?.actions || []) as any[]).map((action: any) => [action.key, action]),
      );

      return {
        id: binding.id,
        connector_id: binding.connector_id || binding.connectorId,
        connector_name: binding.connector_name || binding.connectorName || connector?.name || '',
        connector_slug: connector?.slug || '',
        actions: (binding.actions || [])
          .filter((action: any) => action.isEnabled !== false)
          .map((action: any) => {
            const actionKey = action.action_key || action.actionKey;
            const ca = connectorActions.get(actionKey);
            return {
              action_key: actionKey,
              label: action.label || ca?.label || actionKey,
              description: action.description || ca?.description || '',
              parameter_schema: this.toGrpcStruct(
                ca?.parameterSchema || action.parameterSchema || {},
              ),
              parameter_schema_json: JSON.stringify(
                ca?.parameterSchema || action.parameterSchema || {},
              ),
            };
          }),
        credential_id: binding.credential_id || binding.credentialId || null,
        fixed_params: binding.fixed_params || binding.fixedParams || {},
        disable_auto_skills: binding.disable_auto_skills || binding.disableAutoSkills || false,
        mcp_transport_type: connector?.mcpTransportType || '',
        mcp_server_url: connector?.mcpServerUrl || '',
        mcp_server_config: this.toGrpcStruct(connector?.mcpServerConfig || {}),
        auth_headers: (binding as any).auth_headers || ({} as Record<string, string>),
        auth_env: (binding as any).auth_env || ({} as Record<string, string>),
      };
    });

    if (userId) {
      for (const binding of result) {
        const connector = connectorMap.get(binding.connector_id);
        if (!connector) continue;

        if (connector.authSourceType === 'connected_app' && connector.connectedAppKey) {
          try {
            const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
              authSourceType: connector.authSourceType,
              connectedAppKey: connector.connectedAppKey,
              runtimeAuthConfig: connector.runtimeAuthConfig || {},
            });
            binding.auth_headers = auth.headers;
            binding.auth_env = auth.env;
          } catch (err) {
            this.logger.warn('Failed to resolve connector auth', {
              connector_id: binding.connector_id,
              error: (err as Error).message,
            });
          }
        } else if (connector.authSourceType === 'credential') {
          try {
            const credentialId = (binding as any).credential_id;
            if (credentialId) {
              const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
                authSourceType: connector.authSourceType,
                connectedAppKey: connector.connectedAppKey,
                runtimeAuthConfig: connector.runtimeAuthConfig || {},
                connectorId: binding.connector_id,
                credentialId,
              });
              binding.auth_headers = auth.headers;
              binding.auth_env = auth.env;
            } else {
              const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
                authSourceType: connector.authSourceType,
                connectedAppKey: connector.connectedAppKey,
                runtimeAuthConfig: connector.runtimeAuthConfig || {},
                connectorId: binding.connector_id,
              });
              binding.auth_headers = auth.headers;
              binding.auth_env = auth.env;
            }
          } catch (err) {
            this.logger.warn('Failed to resolve credential auth', {
              connector_id: binding.connector_id,
              error: (err as Error).message,
            });
          }
        }
      }
    }

    this.logger.debug('buildGrpcToolBindings result', {
      totalBindings: result.length,
      totalActions: result.reduce((sum: number, b: any) => sum + (b.actions?.length || 0), 0),
      bindings: result.map((b: any) => ({
        id: b.id,
        connector_id: b.connector_id,
        action_count: b.actions?.length,
        has_transport: !!b.mcp_transport_type,
        has_url: !!b.mcp_server_url,
        actions_have_schema: (b.actions || []).every((a: any) => {
          const schema = a.parameter_schema || a.parameter_schema_json;
          return schema && schema !== '{}' && schema !== '{}';
        }),
      })),
    });

    return result;
  }

  private mapGrpcToolTrace(rawToolTrace: any[] = []): Array<{
    callIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    outputSummary: string | null;
  }> {
    return (rawToolTrace || []).map((item: any) => ({
      callIndex: Number(item?.call_index || 0),
      toolName: item?.tool_name || '',
      args: item?.args && typeof item.args === 'object' ? this.normalizeStructLike(item.args) : {},
      outputSummary: item?.output_summary || null,
    }));
  }

  private mapGrpcLlmPromptTrace(rawPromptTrace: any[] = []): Array<{
    stage: string;
    model: string;
    prompt: string;
  }> {
    return (rawPromptTrace || []).map((item: any) => ({
      stage: String(item?.stage || ''),
      model: String(item?.model || ''),
      prompt: String(item?.prompt || ''),
    }));
  }

  private mapGrpcSemanticMatch(rawSemanticMatch: any): {
    matchScore: number;
    semanticSimilarityScore: number;
    evidenceConsistencyScore: number;
    judgeScore: number;
    reason: string;
    missingPoints: string[];
    changedPoints: string[];
    model: string;
    judgeUsed: boolean;
  } | null {
    if (!rawSemanticMatch || typeof rawSemanticMatch !== 'object') {
      return null;
    }

    const hasSignal =
      rawSemanticMatch.match_score !== undefined ||
      rawSemanticMatch.semantic_similarity_score !== undefined ||
      rawSemanticMatch.reason ||
      rawSemanticMatch.judge_used !== undefined;

    if (!hasSignal) {
      return null;
    }

    return {
      matchScore: Number(rawSemanticMatch.match_score ?? 0),
      semanticSimilarityScore: Number(rawSemanticMatch.semantic_similarity_score ?? 0),
      evidenceConsistencyScore: Number(rawSemanticMatch.evidence_consistency_score ?? 0),
      judgeScore: Number(rawSemanticMatch.judge_score ?? 0),
      reason: String(rawSemanticMatch.reason || ''),
      missingPoints: Array.isArray(rawSemanticMatch.missing_points)
        ? rawSemanticMatch.missing_points.map(String)
        : [],
      changedPoints: Array.isArray(rawSemanticMatch.changed_points)
        ? rawSemanticMatch.changed_points.map(String)
        : [],
      model: String(rawSemanticMatch.model || ''),
      judgeUsed: Boolean(rawSemanticMatch.judge_used),
    };
  }

  private async buildPromptOverrides(): Promise<Record<string, string>> {
    return this.promptService.getPromptOverridesPayload();
  }

  private resolveStreamStepStatus(update: any): string {
    const rawStatus = typeof update?.status === 'string' ? update.status.trim() : '';
    const resultStatus =
      typeof update?.result?.status === 'string' ? update.result.status.trim() : '';

    if (['completed', 'failed', 'skipped'].includes(resultStatus) && rawStatus !== 'suspended') {
      return resultStatus;
    }
    if (rawStatus) {
      return rawStatus;
    }
    if (update?.interrupt) {
      return 'suspended';
    }
    return resultStatus;
  }

  private normalizeStreamStepUpdate(update: any): any {
    const status = this.resolveStreamStepStatus(update);
    if (!status || update?.status === status) {
      return update;
    }

    return {
      ...update,
      status,
    };
  }

  private formatReplayForGrpc(replay: any) {
    return {
      replay_id: replay.id,
      task_id: replay.taskId,
      validation_version: replay.validationVersion,
      mode: replay.mode,
      reference_output: replay.referenceOutput || '',
      preserve_output_format: Boolean(replay.preserveOutputFormat),
      output_format_guide: replay.outputFormatGuide || '',
      tool_calls: (replay.toolCalls || []).map((call: any) => ({
        call_index: call.callIndex,
        tool_name: call.toolName,
        args: this.toGrpcStruct(this.normalizeStructLike(call.args || {})),
        output_summary: call.outputSummary || '',
      })),
    };
  }

  private applyOutputFormatGuide(
    description: string | null | undefined,
    outputFormat:
      | { generationStatus?: string | null; formatGuide?: string | null }
      | null
      | undefined,
  ) {
    const baseDescription = (description || '').trim();
    const guide = (
      outputFormat?.generationStatus === 'ready' ? outputFormat.formatGuide : ''
    )?.trim();
    if (!guide) {
      return baseDescription;
    }

    const formatInstruction = [
      '## Output format requirements',
      'Follow this output structure and formatting exactly, while using current facts and evidence.',
      '',
      guide,
    ].join('\n');

    return baseDescription ? `${baseDescription}\n\n${formatInstruction}` : formatInstruction;
  }

  private buildReplaySourceMap(replayMap: Map<string, any>) {
    const result: Record<string, { replayId: string; validationVersion: number }> = {};
    for (const [taskId, replay] of replayMap.entries()) {
      result[taskId] = {
        replayId: replay.id,
        validationVersion: replay.validationVersion,
      };
    }
    return result;
  }

  private scheduleSemanticEvaluation(
    userId: string,
    executionId: string,
    taskId: string,
    status: string,
    runEvaluation: boolean,
  ): void {
    if (status !== 'completed' || !runEvaluation) {
      return;
    }
    this.semanticEnrichmentService.schedule(userId, executionId, taskId);
  }

  private scheduleNodeReflection(
    userId: string,
    executionId: string,
    taskId: string,
    status: string,
    reflectionEnabled: boolean,
  ): void {
    if (status !== 'completed' || !reflectionEnabled) {
      return;
    }
    this.judgeEnrichmentService.schedule(userId, executionId, taskId);
  }

  private isSkipStepReason(reason?: string | null): boolean {
    return reason === SKIP_STEP_REASON;
  }

  private normalizeResumeAction(dto: ResumePlaybookDto): 'reply' | 'approve' | 'reject' | 'skip' {
    if (
      dto.action === 'reply' ||
      dto.action === 'approve' ||
      dto.action === 'reject' ||
      dto.action === 'skip'
    ) {
      return dto.action;
    }
    if (this.isSkipStepReason(dto.reason)) {
      return 'skip';
    }
    if (dto.approved === true) {
      return 'approve';
    }
    if (dto.approved === false) {
      return dto.feedback ? 'reply' : 'reject';
    }
    return dto.message?.trim() ? 'reply' : 'approve';
  }

  private normalizeResumeMessage(dto: ResumePlaybookDto): string {
    return dto.message?.trim() || dto.feedback?.trim() || dto.reason?.trim() || '';
  }

  private buildInterruptPayload(interrupt: any, threadId = ''): Record<string, unknown> | null {
    if (!interrupt) {
      return null;
    }

    return {
      type: interrupt.type || 'unknown',
      taskId: interrupt.task_id || '',
      taskTitle: interrupt.task_title || '',
      message: interrupt.message || '',
      threadId: threadId || interrupt.thread_id || '',
      interruptId: interrupt.interrupt_id || '',
      round: interrupt.round || 0,
      payloadJson: interrupt.conversation_json || '',
      resumableActions: interrupt.resumable_actions || [],
      taskDescription: interrupt.task_description || '',
      result: interrupt.result || '',
    };
  }

  private buildHitlHistoryEntry(interrupt: any): Record<string, unknown> | null {
    if (!interrupt) {
      return null;
    }

    return {
      interruptId: interrupt.interrupt_id || '',
      taskId: interrupt.task_id || '',
      type: interrupt.type || 'unknown',
      taskTitle: interrupt.task_title || '',
      message: interrupt.message || '',
      taskDescription: interrupt.task_description || '',
      result: interrupt.result || '',
      round: interrupt.round || 0,
      payloadJson: interrupt.conversation_json || '',
      resumableActions: interrupt.resumable_actions || [],
      status: 'pending',
      responseAction: null,
      responseMessage: null,
      responseApproved: null,
      responseReason: null,
      responseFeedback: null,
      respondedBy: null,
      respondedAt: null,
      createdAt: new Date(),
    };
  }

  private async recordPendingInterrupt(executionId: string, interrupt: any, threadId = ''): Promise<void> {
    const interruptPayload = this.buildInterruptPayload(interrupt, threadId);
    const hitlHistoryEntry = this.buildHitlHistoryEntry(interrupt);

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.INTERRUPTED,
        threadId: threadId || interrupt?.thread_id || null,
        interruptPayload,
        waitingForHumanInput: true,
        currentInterruptId: (interruptPayload?.interruptId as string) || null,
        currentInterruptTaskId: (interruptPayload?.taskId as string) || null,
      },
      ...(hitlHistoryEntry
        ? {
            $push: {
              hitlHistory: hitlHistoryEntry,
            },
          }
        : {}),
    });
  }

  private async clearPendingInterruptState(executionId: string, attemptNumber: number): Promise<void> {
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.RUNNING,
        interruptPayload: null,
        waitingForHumanInput: false,
        currentInterruptId: null,
        currentInterruptTaskId: null,
        currentAttemptNumber: attemptNumber,
      },
    });
  }

  private async trySetExecutionTerminalState(
    executionId: string,
    status: ExecutionStatus,
    fields: Record<string, any>,
  ): Promise<boolean> {
    const result = await this.executionModel.updateOne(
      {
        _id: executionId,
        status: {
          $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
        },
      },
      {
        $set: {
          status,
          ...fields,
        },
      },
    );

    return result.modifiedCount > 0;
  }

  private async appendAttemptHistory(
    executionId: string,
    attemptNumber: number,
    type: 'initial' | 'resume_interrupt' | 'rerun_step' | 'resume_from_step',
    taskId: string | null,
    threadId: string | null,
  ): Promise<void> {
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: { currentAttemptNumber: attemptNumber },
      $push: {
        attemptHistory: {
          attemptNumber,
          type,
          taskId,
          threadId,
          startedAt: new Date(),
          completedAt: null,
        },
      },
    });
  }

  private async prepareExecutionForRerun(
    executionId: string,
    taskId: string,
    attemptNumber: number,
  ): Promise<void> {
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.RUNNING,
        error: null,
        durationMs: null,
        startedAt: new Date(),
        completedAt: null,
        threadId: null,
        interruptPayload: null,
        waitingForHumanInput: false,
        currentInterruptId: null,
        currentInterruptTaskId: null,
        singleStepTaskId: taskId,
        currentAttemptNumber: attemptNumber,
      },
    });
  }

  private async ensureTaskResultExists(
    executionId: string,
    task: any,
    snapshot: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    attemptNumber: number,
  ): Promise<void> {
    const execution = await this.executionModel
      .findById(executionId)
      .select('taskResults.taskId')
      .lean()
      .exec();
    const existingTaskIds = new Set<string>(
      (execution?.taskResults || []).map((result: any) => result.taskId),
    );
    if (existingTaskIds.has(task.id)) {
      return;
    }

    const enabledTasks = (snapshot?.tasks || []).filter(
      (candidate: any) => candidate.enabled !== false,
    );
    const enabledTaskIds = new Set(enabledTasks.map((candidate: any) => candidate.id));
    const enabledEdges = (snapshot?.edges || []).filter((edge: any) => {
      const sourceId = this.graphService.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.graphService.normalizeEdgeId(edge.targetId ?? edge.target_id);
      return enabledTaskIds.has(sourceId) && enabledTaskIds.has(targetId);
    });
    const orderedTasks = topologicalSortByLevel(enabledTasks, enabledEdges).flat();
    const topoOrderMap = new Map<string, number>();
    orderedTasks.forEach((orderedTask: any, index: number) =>
      topoOrderMap.set(orderedTask.id, index),
    );

    await this.executionModel.findByIdAndUpdate(executionId, {
      $push: {
        taskResults: {
          taskId: task.id,
          nodeTitle: task.title,
          agentName: task.assignedAgentId
            ? grpcAgentMap.get(task.assignedAgentId.toString())?.name || 'Unknown'
            : '',
          order: topoOrderMap.get(task.id) ?? 0,
          attemptNumber,
          isStale: false,
          staleReason: null,
          invalidatedByTaskId: null,
          status: StepStatus.PENDING,
          output: null,
          error: null,
          durationMs: null,
          startedAt: null,
          completedAt: null,
          components: [],
          toolTrace: [],
          llmPromptTrace: [],
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          modelName: null,
          semanticMatch: null,
          evaluationHistory: [],
          stepExecutions: [],
          advisorTurnCount: 0,
          advisorTurnHistory: [],
          lastAdvisorAction: null,
          lastAdvisorScoreDelta: null,
          advisorStopReason: null,
        },
      },
    });
  }

  private async resetTaskForAttempt(
    executionId: string,
    taskId: string,
    attemptNumber: number,
  ): Promise<void> {
    await this.updateTaskResult(executionId, taskId, {
      status: StepStatus.PENDING,
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      components: [],
      toolTrace: [],
      llmPromptTrace: [],
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      modelName: null,
      semanticMatch: null,
      judgeStatus: JudgeStatus.IDLE,
      judgeResult: null,
      judgeError: null,
      attemptNumber,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
      advisorTurnCount: 0,
      advisorTurnHistory: [],
      lastAdvisorAction: null,
      lastAdvisorScoreDelta: null,
      advisorStopReason: null,
    });
  }

  private async markTasksStale(
    executionId: string,
    taskIds: string[],
    invalidatedByTaskId: string,
    attemptNumber: number,
  ): Promise<void> {
    for (const taskId of taskIds) {
      await this.updateTaskResult(executionId, taskId, {
        isStale: true,
        staleReason: 'upstream_task_rerun',
        invalidatedByTaskId,
        attemptNumber,
      });
    }
  }

  private async resetTasksForRecompute(
    executionId: string,
    taskIds: string[],
    invalidatedByTaskId: string,
    attemptNumber: number,
  ): Promise<void> {
    for (const taskId of taskIds) {
      await this.updateTaskResult(executionId, taskId, {
        status: StepStatus.PENDING,
        output: null,
        error: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
        components: [],
        toolTrace: [],
        llmPromptTrace: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelName: null,
        semanticMatch: null,
        attemptNumber,
        isStale: false,
        staleReason: null,
        invalidatedByTaskId,
      });
    }
  }

  private async resolveGrpcAgentsForTasks(
    userId: string,
    tasks: any[],
    playbookSessionId: string,
  ): Promise<Map<string, IGrpcAgent>> {
    const grpcAgentMap = new Map<string, IGrpcAgent>();
    const referencedAgentIds = [
      ...new Set(
        tasks.filter((t: any) => t.assignedAgentId).map((t: any) => t.assignedAgentId.toString()),
      ),
    ];

    if (referencedAgentIds.length === 0) {
      return grpcAgentMap;
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackModelId = defaultModel?.id || '';
    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(
      userId,
      referencedAgentIds,
      fallbackModelId,
      playbookSessionId,
    );
    await this.contextService.resolveAgentBrainContexts(grpcAgents);
    for (const agent of grpcAgents) {
      grpcAgentMap.set(agent.id, agent);
    }
    return grpcAgentMap;
  }

  private async getExecutionForReuse(
    userId: string,
    playbookId: string,
    executionId: string,
  ): Promise<any> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }
    if (execution.executedBy?.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }
    if (execution.playbookId?.toString() !== playbookId) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }
    if (execution.status === ExecutionStatus.RUNNING) {
      throw new ConflictException(ErrorCode.PLAYBOOK_EXECUTION_IN_PROGRESS);
    }
    return execution;
  }

  /**
   * Creates a `PlaybookExecution` and starts the run loop. Use trusted internal callers for
   * `options.executionTrigger === 'scheduled'` or `options.executionTrigger === 'mail'`.
   * only from trusted internal callers (e.g. schedule runner). User-facing `POST /playbooks/:id/execute` must
   * pass `manual` via the controller.
   */
  async executePlaybook(
    userId: string,
    playbookId: string,
    dto: ExecutePlaybookDto,
    userEmail: string = '',
    options?: {
      executionTrigger?: 'manual' | 'scheduled' | 'mail';
      triggerContext?: Record<string, unknown> | null;
      userLanguage?: string;
    },
  ): Promise<{ executionId: string }> {
    const executionTrigger: 'manual' | 'scheduled' | 'mail' =
      options?.executionTrigger === 'scheduled'
        ? 'scheduled'
        : options?.executionTrigger === 'mail'
          ? 'mail'
          : 'manual';
    const mode = dto.singleStepTaskId ? 'single-step' : 'full-workflow';
    const globalExecutionMode = dto.executionMode || 'live';
    const advisorAutopilot = this.advisorService.normalizeAdvisorAutopilotConfig(
      dto.singleStepTaskId ? dto.advisorAutopilotEnabled === true : false,
      dto.advisorAutopilotTargetScore,
      dto.advisorAutopilotMaxTurns,
    );
    this.logger.log('executePlaybook called', {
      userId,
      playbookId,
      mode,
      executionMode: globalExecutionMode,
      singleStepTaskId: dto.singleStepTaskId || null,
      advisorAutopilotEnabled: advisorAutopilot.enabled,
      advisorAutopilotTargetScore: advisorAutopilot.targetScore,
      advisorAutopilotMaxTurns: advisorAutopilot.maxTurns,
      query: dto.query || null,
    });

    if (!this.grpcService.isAvailable) {
      this.logger.warn('gRPC unavailable, rejecting executePlaybook', { userId, playbookId });
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);
    }

    const playbook = await this.playbookService.findRawById(playbookId);
    if (!playbook) {
      this.logger.warn('Playbook not found', { playbookId });
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    this.logger.log('Playbook loaded', {
      playbookId,
      name: playbook.name,
      taskCount: playbook.tasks.length,
      edgeCount: playbook.edges.length,
    });

    if (!playbook.workspaces || playbook.workspaces.length === 0) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Playbook must have a default workspace before execution',
      );
    }

    const enabledTasks = playbook.tasks.filter((task: any) => task.enabled !== false);
    const enabledTaskIds = new Set(enabledTasks.map((task: any) => task.id));
    const enabledEdges = playbook.edges.filter((edge: any) => {
      const sourceId = edge.sourceId?.toString?.() || edge.sourceId;
      const targetId = edge.targetId?.toString?.() || edge.targetId;
      const sourceAllowed = sourceId === '__trigger__' || enabledTaskIds.has(sourceId);
      const targetAllowed = enabledTaskIds.has(targetId);
      return sourceAllowed && targetAllowed;
    });
    const sanitizedEnabledEdges = this.graphService.sanitizeEdgesForTasks(enabledTasks, enabledEdges);
    this.logger.log('[ITERATOR_DEBUG executePlaybook] edges', {
      playbookId,
      iteratorTasks: enabledTasks
        .filter((t: any) => t.taskType === 'iterator')
        .map((t: any) => ({ id: t.id, title: t.title })),
      childTasks: enabledTasks
        .filter((t: any) => t.containerConfig?.parentIteratorId)
        .map((t: any) => ({ id: t.id, parentIteratorId: t.containerConfig?.parentIteratorId })),
      enabledEdges: enabledEdges.map((e: any) => ({
        sourceId: e.sourceId || e.source_id,
        targetId: e.targetId || e.target_id,
      })),
      sanitizedEnabledEdges: sanitizedEnabledEdges.map((e: any) => ({
        sourceId: e.sourceId || e.source_id,
        targetId: e.targetId || e.target_id,
      })),
    });
    const triggerContext = options?.triggerContext ?? null;
    this.logger.debug('////////////////////// [executePlaybook] trigger context input', {
      playbookId,
      executionTrigger,
      hasTriggerContext: !!triggerContext,
      triggerContext,
    });

    if (dto.singleStepTaskId) {
      const targetTask = playbook.tasks.find((task: any) => task.id === dto.singleStepTaskId);
      if (!targetTask) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Selected step does not exist');
      }
      if (targetTask.enabled === false) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Disabled steps cannot be executed');
      }
    }

    // Check for active execution of this playbook
    const activeExecution = await this.executionModel
      .findOne({
        playbookId: new Types.ObjectId(playbookId),
        status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
      })
      .lean()
      .exec();

    if (activeExecution) {
      this.logger.warn('Active execution already exists', {
        playbookId,
        activeExecutionId: activeExecution._id.toString(),
        activeStatus: activeExecution.status,
      });
      throw new ConflictException(ErrorCode.PLAYBOOK_EXECUTION_IN_PROGRESS);
    }

    const executionNumber = await this.playbookService.getNextExecutionNumber(playbookId);
    const playbookSessionId = `playbook:${playbookId}:execution:${executionNumber}`;

    // Resolve only agents referenced by playbook tasks Ã¢â‚¬â€ fully built for gRPC
    const grpcAgentMap = new Map<string, IGrpcAgent>();
    try {
      const referencedAgentIds = [
        ...new Set(
          playbook.tasks
            .filter((t: any) => t.assignedAgentId)
            .map((t: any) => t.assignedAgentId.toString()),
        ),
      ];
      if (referencedAgentIds.length > 0) {
        const defaultModel = await this.modelsService.getDefaultModel();
        const fallbackModelId = defaultModel?.id || '';
        const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(
          userId,
          referencedAgentIds,
          fallbackModelId,
          playbookSessionId,
        );
        await this.contextService.resolveAgentBrainContexts(grpcAgents);
        for (const agent of grpcAgents) {
          grpcAgentMap.set(agent.id, agent);
        }
      }
      this.logger.log('Agents resolved for gRPC', {
        userId,
        agentCount: grpcAgentMap.size,
        referencedCount: referencedAgentIds.length,
        playbookSessionId,
      });
    } catch (err) {
      this.logger.warn('Failed to load agents for playbook execution', {
        userId,
        playbookSessionId,
        error: (err as Error).message,
      });
    }

    // Topological sort by level Ã¢â‚¬â€ determines execution order and parallelism
    const orderedLevels = topologicalSortByLevel(enabledTasks, sanitizedEnabledEdges);
    const orderedTasks = orderedLevels.flat();

    // Build a map from taskId to topological index
    const topoOrderMap = new Map<string, number>();
    orderedTasks.forEach((task, index) => topoOrderMap.set(task.id, index));

    // Build task results using topological order
    const taskResults = playbook.tasks.map((task) => ({
      taskId: task.id,
      nodeTitle: task.title,
      agentName: task.assignedAgentId
        ? grpcAgentMap.get(task.assignedAgentId.toString())?.name || 'Unknown'
        : '',
      order: topoOrderMap.get(task.id) ?? 0,
      attemptNumber: 1,
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
      status:
        dto.singleStepTaskId && dto.singleStepTaskId !== task.id
          ? StepStatus.SKIPPED
          : task.enabled === false
            ? StepStatus.SKIPPED
            : StepStatus.PENDING,
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      judgeStatus: 'idle',
      judgeResult: null,
      judgeHistory: [],
      advisorTurnCount: 0,
      advisorTurnHistory: [],
      lastAdvisorAction: null,
      lastAdvisorScoreDelta: null,
      advisorStopReason: null,
    }));

    const stepExecutionModes = dto.stepExecutionModes || {};
    const effectiveModes = new Map<string, string>();

    for (const task of enabledTasks) {
      if (dto.singleStepTaskId && task.id !== dto.singleStepTaskId) continue;
      const effectiveMode =
        globalExecutionMode === 'inherit'
          ? (stepExecutionModes[task.id] ?? (task as any).stepReplayMode ?? 'live')
          : 'live';
      effectiveModes.set(task.id, effectiveMode);
    }

    const replayTaskIds = [...effectiveModes.entries()]
      .filter(([, m]) => m !== 'live')
      .map(([id]) => id);
    const executionTaskIds = [...effectiveModes.keys()];
    const activeReplayMap = await this.replayService.getActiveReplays(playbookId, replayTaskIds);
    const activeOutputFormatMap = await this.outputFormatService.getActiveTemplates(
      playbookId,
      executionTaskIds,
    );

    const hasReplaySteps = replayTaskIds.length > 0;
    const reflectionEnabled =
      dto.runNodeReflection ?? (playbook as any).reflectionEnabled !== false;

    const execution = await this.executionModel.create({
      playbookId: new Types.ObjectId(playbookId),
      executedBy: new Types.ObjectId(userId),
      executionNumber,
      currentAttemptNumber: 1,
      status: ExecutionStatus.RUNNING,
      engineVersion: this.portUnificationV2Enabled ? 2 : 1,
      executionMode: globalExecutionMode,
      executionTrigger,
      triggerContext: options?.triggerContext ?? null,
      runEvaluation: dto.runEvaluation === true,
      reflectionEnabled,
      advisorAutopilotEnabled: advisorAutopilot.enabled,
      advisorAutopilotTargetScore: advisorAutopilot.targetScore,
      advisorAutopilotMaxTurns: advisorAutopilot.maxTurns,
      advisorAutopilotStatus: advisorAutopilot.enabled ? 'running' : 'idle',
      advisorAutopilotTaskId: dto.singleStepTaskId || null,
      advisorAutopilotAttemptCount: 0,
      advisorAutopilotLastError: null,
      judgeSummaryStatus: 'idle',
      judgeSummary: null,
      replaySourceByTask: hasReplaySteps ? this.buildReplaySourceMap(activeReplayMap) : null,
      taskResults,
      threadId: null,
      interruptPayload: null,
      waitingForHumanInput: false,
      currentInterruptId: null,
      currentInterruptTaskId: null,
      hitlHistory: [],
      error: null,
      durationMs: null,
      startedAt: new Date(),
      completedAt: null,
      singleStepTaskId: dto.singleStepTaskId || null,
      attemptHistory: [
        {
          attemptNumber: 1,
          type: 'initial',
          taskId: dto.singleStepTaskId || null,
          threadId: null,
          startedAt: new Date(),
          completedAt: null,
        },
      ],
      playbookSnapshot: {
        tasks: playbook.tasks.map((t) => ((t as any).toObject ? (t as any).toObject() : t)),
        edges: sanitizedEnabledEdges.map((e) => ((e as any).toObject ? (e as any).toObject() : e)),
      },
    });

    this.logger.debug('////////////////////// [executePlaybook] execution created', {
      executionId: execution._id.toString(),
      playbookId,
      executionTrigger,
      hasTriggerContext: !!(execution as any).triggerContext,
      triggerContext: (execution as any).triggerContext ?? null,
    });

    const executionId = execution._id.toString();

    this.logger.debug('Execution record created', {
      executionId,
      playbookId,
      executionNumber,
      mode,
      taskResultCount: taskResults.length,
      pendingCount: taskResults.filter((tr) => tr.status === StepStatus.PENDING).length,
      skippedCount: taskResults.filter((tr) => tr.status === StepStatus.SKIPPED).length,
    });

    // Send SSE: execution start (include taskResults so frontend has correct order/metadata)
    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_start',
      data: {
        executionId,
        playbookId,
        executionNumber,
        status: ExecutionStatus.RUNNING,
        executionMode: globalExecutionMode,
        executionTrigger,
        reflectionEnabled,
        advisorAutopilotEnabled: advisorAutopilot.enabled,
        advisorAutopilotTargetScore: advisorAutopilot.targetScore,
        advisorAutopilotMaxTurns: advisorAutopilot.maxTurns,
        advisorAutopilotStatus: advisorAutopilot.enabled ? 'running' : 'idle',
        advisorAutopilotTaskId: dto.singleStepTaskId || null,
        advisorAutopilotAttemptCount: 0,
        advisorAutopilotLastError: null,
        singleStepTaskId: dto.singleStepTaskId || null,
        replaySourceByTask: hasReplaySteps ? this.buildReplaySourceMap(activeReplayMap) : null,
        taskResults,
      },
    });
    this.logger.debug('SSE playbook_execution_start sent', { executionId, userId });

    // Build workspace contexts from playbook-linked workspaces
    const workspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);

    if (dto.singleStepTaskId) {
      // Single-step mode: use RunStep gRPC for just the one task
      this.logger.debug('Starting single-step execution loop', {
        executionId,
        taskId: dto.singleStepTaskId,
      });
      const singleStepTask = orderedTasks.find((task: any) => task.id === dto.singleStepTaskId);
      const selectedExecutionMode = effectiveModes.get(dto.singleStepTaskId) || 'live';
      const validatedReplay = activeReplayMap.get(dto.singleStepTaskId) || null;
      if (!singleStepTask) {
        throw new BadRequestException(
          ErrorCode.BAD_REQUEST,
          'Selected step does not exist in the execution order',
        );
      }
      if (advisorAutopilot.enabled && !singleStepTask.disableAdvisorEvaluation) {
        this.runSingleStepAdvisorAutopilot(
          userId,
          executionId,
          playbook,
          singleStepTask,
          grpcAgentMap,
          workspaceContexts,
          userEmail,
          selectedExecutionMode,
          validatedReplay,
          dto.streaming === true,
          advisorAutopilot,
        ).catch(async (err) => {
          this.logger.error('Advisor Autopilot loop failed', {
            executionId,
            taskId: dto.singleStepTaskId,
            error: (err as Error).message,
          });
          try {
            await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
              status: 'failed',
              taskId: dto.singleStepTaskId || null,
              lastError: (err as Error).message,
            });
            const exec = await this.executionModel
              .findById(executionId)
              .select('startedAt status')
              .lean()
              .exec();
            const startedAt = exec?.startedAt ? new Date(exec.startedAt) : new Date();
            const isTerminal =
              exec?.status && ['completed', 'failed', 'cancelled'].includes(exec.status as string);
            if (!isTerminal) {
              await this.markRemainingSkippedAndFail(
                userId,
                executionId,
                (err as Error).message,
                startedAt,
              );
            }
          } catch (finalizeErr) {
            this.logger.error('Failed to finalize execution after Advisor Autopilot error', {
              executionId,
              error: (finalizeErr as Error).message,
            });
          }
        });
        return { executionId };
      }
      this.runSingleStepExecution(
        userId,
        executionId,
        playbook,
        singleStepTask,
        grpcAgentMap,
        workspaceContexts,
        userEmail,
        selectedExecutionMode,
        validatedReplay,
        dto.streaming === true,
        dto.runEvaluation === true,
        reflectionEnabled,
      ).catch(async (err) => {
        this.logger.error('Execution loop failed', {
          executionId,
          error: (err as Error).message,
        });
        try {
          const exec = await this.executionModel
            .findById(executionId)
            .select('startedAt status')
            .lean()
            .exec();
          const startedAt = exec?.startedAt ? new Date(exec.startedAt) : new Date();
          const isTerminal =
            exec?.status && ['completed', 'failed', 'cancelled'].includes(exec.status as string);
          if (!isTerminal) {
            await this.markRemainingSkippedAndFail(
              userId,
              executionId,
              (err as Error).message,
              startedAt,
            );
          }
        } catch (finalizeErr) {
          this.logger.error('Failed to finalize execution after loop error', {
            executionId,
            error: (finalizeErr as Error).message,
          });
        }
      });
    } else {
      // Full workflow mode: delegate to LangGraph via RunPlaybookWorkflow
      this.logger.debug('Starting full workflow execution', { executionId, playbookId });
      this.runFullWorkflow(
        userId,
        executionId,
        playbook,
        grpcAgentMap,
        dto,
        effectiveModes,
        workspaceContexts,
        userEmail,
        playbook.name,
        activeReplayMap,
        activeOutputFormatMap,
        options?.userLanguage || 'en',
      ).catch(async (err) => {
        this.logger.error('Full workflow failed', {
          executionId,
          error: (err as Error).message,
        });
        try {
          const exec = await this.executionModel
            .findById(executionId)
            .select('startedAt status')
            .lean()
            .exec();
          const startedAt = exec?.startedAt ? new Date(exec.startedAt) : new Date();
          const isTerminal =
            exec?.status && ['completed', 'failed', 'cancelled'].includes(exec.status as string);
          if (!isTerminal) {
            await this.markRemainingSkippedAndFail(
              userId,
              executionId,
              (err as Error).message,
              startedAt,
            );
          }
        } catch (finalizeErr) {
          this.logger.error('Failed to finalize execution after workflow error', {
            executionId,
            error: (finalizeErr as Error).message,
          });
        }
      });
    }

    return { executionId };
  }

  async executePlaybookByIntegrationToken(
    token: string,
    dto: ExecutePlaybookDto,
  ): Promise<{ executionId: string }> {
    const playbook = await this.playbookService.findByIntegrationToken(token);

    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const ownerId = playbook.createdBy?.toString?.() || '';
    if (!ownerId) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const owner = await this.userService.findById(ownerId);
    return this.executePlaybook(ownerId, playbook._id.toString(), dto, owner?.email || '', {
      executionTrigger: 'manual',
      userLanguage: (owner as any)?.appearance?.language || 'en',
    });
  }

  /**
   * Full workflow execution: delegates orchestration to LangGraph via RunPlaybookWorkflow.
   * Consumes server-side stream, forwarding step updates to frontend via SSE in real-time.
   * DB writes are batched at stream end via flushStepBuffer.
   */
  private async runFullWorkflow(
    userId: string,
    executionId: string,
    playbook: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    dto: ExecutePlaybookDto,
    effectiveModes: Map<string, string>,
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [],
    userEmail: string = '',
    playbookName: string = '',
    activeReplayMap: Map<string, any> = new Map(),
    activeOutputFormatMap: Map<string, any> = new Map(),
    userLanguage: string = 'en',
  ): Promise<void> {
    this.logger.debug('runFullWorkflow start', { executionId, userId });

    const execution = await this.executionModel
      .findById(executionId)
      .select('taskResults.taskId taskResults.status playbookSnapshot playbookId startedAt triggerContext')
      .lean()
      .exec();
    if (!execution) {
      this.logger.warn('runFullWorkflow: execution not found', { executionId });
      return;
    }

    const startedAt = execution.startedAt!;
    const playbookId = execution.playbookId.toString();
    const triggerContext = (execution as any).triggerContext ?? null;
    this.logger.debug('////////////////////// [runFullWorkflow] execution trigger context read', {
      executionId,
      rawExecutionKeys: Object.keys(execution as any),
      hasCamelCaseTriggerContext: Object.prototype.hasOwnProperty.call(
        execution as any,
        'triggerContext',
      ),
      hasSnakeCaseTriggerContext: Object.prototype.hasOwnProperty.call(
        execution as any,
        'trigger_context',
      ),
      triggerContext,
    });
    const globalExecutionMode = dto.executionMode || 'live';
    const enabledTasks = playbook.tasks.filter((task: any) => task.enabled !== false);
    const enabledTaskIds = new Set(enabledTasks.map((task: any) => task.id));
    const enabledEdges = (playbook.edges || []).filter((edge: any) => {
      const sourceId = edge.sourceId?.toString?.() || edge.sourceId || edge.source_id;
      const targetId = edge.targetId?.toString?.() || edge.targetId || edge.target_id;
      const sourceAllowed = sourceId === '__trigger__' || enabledTaskIds.has(sourceId);
      const targetAllowed = enabledTaskIds.has(targetId);
      return sourceAllowed && targetAllowed;
    });
    const sanitizedEnabledEdges = this.graphService.sanitizeEdgesForTasks(enabledTasks, enabledEdges);
    this.logger.log('[ITERATOR_DEBUG runPlaybookWorkflow] edges', {
      iteratorTasks: enabledTasks
        .filter((t: any) => t.taskType === 'iterator')
        .map((t: any) => ({ id: t.id, title: t.title })),
      childTasks: enabledTasks
        .filter((t: any) => t.containerConfig?.parentIteratorId)
        .map((t: any) => ({ id: t.id, parentIteratorId: t.containerConfig?.parentIteratorId })),
      enabledEdges: enabledEdges.map((e: any) => ({
        sourceId: e.sourceId || e.source_id,
        targetId: e.targetId || e.target_id,
      })),
      sanitizedEnabledEdges: sanitizedEnabledEdges.map((e: any) => ({
        sourceId: e.sourceId || e.source_id,
        targetId: e.targetId || e.target_id,
      })),
    });

    // Build RunPlaybookWorkflowRequest
    const stepExecutionModesForGrpc: Record<string, string> = {};
    for (const task of enabledTasks) {
      const em = effectiveModes.get(task.id);
      if (em && em !== 'live') {
        stepExecutionModesForGrpc[task.id] = em;
      }
    }

    // Pre-extract input file IDs for all tasks (port-aware)
    const taskInputFileIdsByPortMap = new Map<
      string,
      Array<{ port_id: string; document_ids: string[] }>
    >();
    const workspaceContextMap = new Map<string, Map<string, any>>();

    const addWorkspaceContexts = (
      contexts: Array<{ workspace_id: string; workspace_documents: any[] }>,
    ) => {
      for (const ctx of contexts || []) {
        const workspaceId = ctx.workspace_id;
        if (!workspaceId) continue;

        if (!workspaceContextMap.has(workspaceId)) {
          workspaceContextMap.set(workspaceId, new Map<string, any>());
        }

        const workspaceDocs = workspaceContextMap.get(workspaceId)!;
        for (const doc of ctx.workspace_documents || []) {
          const docId = doc?._id || doc?.id;
          if (!docId) continue;
          workspaceDocs.set(String(docId), doc);
        }
      }
    };

    addWorkspaceContexts(workspaceContexts);

    for (const task of enabledTasks) {
      if (task.inputFiles && task.inputFiles.length > 0) {
        const idsByPort = await this.contextService.extractDocumentIdsByPort(task.inputFiles);
        taskInputFileIdsByPortMap.set(task.id, idsByPort);

        const taskWorkspaceContexts = await this.contextService.buildWorkspaceContextFromInputFiles(
          task.inputFiles,
        );
        addWorkspaceContexts(taskWorkspaceContexts);
      }
    }

    const playbookWorkspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const defaultWorkspaceId = playbookWorkspaceIds[0] || '';

    const effectiveWorkspaceContexts = Array.from(workspaceContextMap.entries()).map(
      ([workspace_id, docMap]) => ({
        workspace_id,
        workspace_documents: Array.from(docMap.values()),
      }),
    );

    // Ensure the playbook's default workspace is always first so the ADK
    // picks the correct output workspace via select_output_workspace_id.
    if (defaultWorkspaceId && effectiveWorkspaceContexts.length > 0) {
      const defaultIdx = effectiveWorkspaceContexts.findIndex(
        (ctx) => ctx.workspace_id === defaultWorkspaceId,
      );
      if (defaultIdx > 0) {
        const [moved] = effectiveWorkspaceContexts.splice(defaultIdx, 1);
        effectiveWorkspaceContexts.unshift(moved);
      }
    }
    const toolBindingsByTaskId = new Map<string, any[]>();
    for (const task of enabledTasks) {
      toolBindingsByTaskId.set(
        task.id,
        await this.buildGrpcToolBindings(
          task.toolBindings || [],
          task.assignedAgentId
            ? grpcAgentMap.get(task.assignedAgentId.toString())?.connectorIds
            : undefined,
          userId,
        ),
      );
    }
    const promptOverrides = await this.buildPromptOverrides();

    const request: any = {
      user_context: { user_id: userId, username: userEmail },
      playbook_id: playbookId,
      query: dto.query || '',
      tasks: enabledTasks.map((t: any) => {
        const taskMode = effectiveModes.get(t.id) || 'live';
        return {
          id: t.id,
          title: t.title,
          description: this.applyOutputFormatGuide(
            t.description || '',
            activeOutputFormatMap.get(t.id),
          ),
          assigned_agent_id: t.assignedAgentId?.toString() || '',
          execution_mode: t.executionMode || 'agent',
          selected_action: t.selectedAction || null,
          execution_order: t.executionOrder || 0,
          interrupt_before: t.interruptBefore || false,
          interrupt_after: t.interruptAfter || false,
          allow_clarification: t.allowClarification || false,
          clarification_prompt: t.clarificationPrompt || '',
          max_clarifications: t.maxClarifications || 3,
          input_keys: t.inputKeys || [],
          output_key: t.outputKey || '',
          input_files_by_port: taskInputFileIdsByPortMap.get(t.id) || [],
          input_ports: (t.inputPorts || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            artifact_kind: p.artifactKind,
            required: p.required || false,
            description: p.description || '',
          })),
          output_ports: (t.outputPorts || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            artifact_kind: p.artifactKind,
            description: p.description || '',
          })),
          task_type: t.taskType || 'generic',
          evaluation_config: t.evaluationConfig
            ? {
                expectation: t.evaluationConfig.expectation || '',
                reference_baseline_id: t.evaluationConfig.referenceBaselineId || null,
                pass_threshold: t.evaluationConfig.passThreshold ?? 80,
                warning_threshold: t.evaluationConfig.warningThreshold ?? 60,
                weight: t.evaluationConfig.weight ?? 1,
                rubric_version: t.evaluationConfig.rubricVersion || 'evaluation-node-v1',
                weights: t.evaluationConfig.weights || {},
              }
            : null,
          task_metadata: this.toGrpcStruct({
            ...(t.taskType === 'iterator' && t.iteratorConfig
              ? {
                  iterator: {
                    source: t.iteratorConfig.source || '{{items}}',
                    mode: t.iteratorConfig.mode === 'batch' ? 'batch' : 'item',
                    batchSize: t.iteratorConfig.batchSize ?? 10,
                    itemVariable: t.iteratorConfig.itemVariable || 'item',
                    outputVariable: t.iteratorConfig.outputVariable || 'processed_items',
                    errorStrategy: t.iteratorConfig.errorStrategy === 'continue' ? 'continue' : 'stop',
                  },
                }
              : {}),
            ...(t.containerConfig?.parentIteratorId
              ? {
                  container: {
                    parentIteratorId: t.containerConfig.parentIteratorId,
                  },
                }
              : {}),
          }),
          tool_bindings: toolBindingsByTaskId.get(t.id) || [],
        };
      }),
      agents: [],
      edges: sanitizedEnabledEdges.map((e: any) => ({
        source_id: e.sourceId || e.source_id,
        target_id: e.targetId || e.target_id,
        source_output_port_id: e.sourceOutputPortId || 'default',
        target_input_port_id: e.targetInputPortId || 'default',
      })),
      workspace_context: effectiveWorkspaceContexts,
      execution_mode: 'live',
      step_execution_modes: stepExecutionModesForGrpc,
      prompt_overrides: promptOverrides,
      user_language: userLanguage || 'en',
    };

    if (triggerContext && typeof triggerContext === 'object') {
      request.trigger_context = this.normalizeStructLike(triggerContext);
      request.trigger_context_json = JSON.stringify(this.normalizeStructLike(triggerContext));
    }
    this.logger.debug('////////////////////// [RunPlaybookWorkflow] trigger context after assignment', {
      executionId,
      hasTriggerContext: !!request.trigger_context,
      triggerContextKeys:
        request.trigger_context && typeof request.trigger_context === 'object'
          ? Object.keys(request.trigger_context)
          : [],
      triggerContextJsonPresent: !!request.trigger_context_json,
    });

    if (activeReplayMap.size > 0) {
      request.validated_replays = Array.from(activeReplayMap.values()).map((replay) => {
        const outputFormat = activeOutputFormatMap.get(replay.taskId);
        return this.formatReplayForGrpc({
          ...replay,
          preserveOutputFormat:
            outputFormat?.generationStatus === 'ready' ? true : replay.preserveOutputFormat,
          outputFormatGuide:
            outputFormat?.generationStatus === 'ready' && outputFormat?.formatGuide
              ? outputFormat.formatGuide
              : replay.outputFormatGuide,
        });
      });
    }

    // Build agents array from pre-built gRPC agents
    const referencedAgentIds = new Set<string>();
    for (const task of playbook.tasks) {
      if (task.assignedAgentId) {
        referencedAgentIds.add(task.assignedAgentId.toString());
      }
    }

    for (const agentId of referencedAgentIds) {
      const grpcAgent = grpcAgentMap.get(agentId);
      if (grpcAgent) {
        request.agents.push(grpcAgent);
      }
    }

    this.logger.debug('RunPlaybookWorkflow gRPC request built', {
      executionId,
      playbookId,
      taskCount: request.tasks?.length,
      agentCount: request.agents?.length,
      edgeCount: request.edges?.length,
      requestKeys: Object.keys(request),
      triggerContextPresent: !!request.trigger_context,
      triggerContextKeys:
        request.trigger_context && typeof request.trigger_context === 'object'
          ? Object.keys(request.trigger_context)
          : [],
      query: request.query || null,
      tasksWithInputFiles:
        request.tasks
          ?.filter((t: any) => t.input_files_by_port?.length > 0)
          .map((t: any) => ({
            taskId: t.id,
            inputFilesByPort: t.input_files_by_port || [],
          })) || [],
    });
    this.logger.debug('RunPlaybookWorkflow bound document resolution summary', {
      executionId,
      playbookId,
      tasks:
        request.tasks
          ?.filter((t: any) => t.input_files_by_port?.length > 0)
          .map((t: any) => {
            const boundIds = (t.input_files_by_port || []).flatMap(
              (binding: any) => binding.document_ids || [],
            );
            const workspaceMatches = (request.workspace_context || []).map((ctx: any) => ({
              workspaceId: ctx.workspace_id,
              documents: (ctx.workspace_documents || [])
                .filter((doc: any) => boundIds.includes(doc?._id || doc?.id))
                .map((doc: any) => ({
                  id: doc?._id || doc?.id || '',
                  filename: doc?.filename || '',
                  filepath: doc?.filepath || '',
                })),
            }));

            return {
              taskId: t.id,
              inputFilesByPort: t.input_files_by_port || [],
              boundIds,
              workspaceMatches,
            };
          }) || [],
    });
    this.logger.debug('RunPlaybookWorkflow gRPC request body summary', {
      executionId,
      playbookId,
      requestSize: JSON.stringify(request).length,
      workspaceContextCount: request.workspace_context?.length || 0,
      workspaceDocumentCount: (request.workspace_context || []).reduce(
        (sum: number, ctx: any) => sum + ((ctx.workspace_documents || []).length || 0),
        0,
      ),
      taskIds: (request.tasks || []).map((task: any) => task.id),
    });

    // Build task map for email notifications
    const taskMap = new Map<string, any>();
    for (const t of playbook.tasks) taskMap.set(t.id, t);

    const call = this.grpcService.runPlaybookWorkflow(request);
    return this.consumePlaybookStream(
      userId,
      executionId,
      call,
      startedAt,
      undefined,
      undefined,
      taskMap,
      playbookName,
      playbookId,
    );
  }

  /**
   * Handle a single PlaybookStepUpdate from the gRPC stream.
   * Updates the in-memory buffer and sends SSE events.
   * DB persistence happens at stream end via flushStepBuffer;
   * catch-up reads merge from activeStepBuffers in findActiveExecutionsByUser.
   */
  private handleStepUpdate(
    userId: string,
    executionId: string,
    update: any,
    stepBuffer: Map<string, BufferedStepResult>,
    taskMap: Map<string, any> = new Map(),
    playbookName: string = '',
    evalEnabled: boolean = false,
    reflectionEnabled: boolean = true,
    playbookId: string = '',
  ): void {
    const normalizedUpdate = this.normalizeStreamStepUpdate(update);
    const { task_id: taskId, status, result, interrupt } = normalizedUpdate;
    const scope = normalizedUpdate?.scope || '';
    const parentIteratorId = normalizedUpdate?.parent_iterator_id || '';
    const iterationIndex = Number(normalizedUpdate?.iteration_index || 0);
    const isIteratorChildUpdate = scope === 'iterator_child' && Boolean(parentIteratorId);

    this.logger.debug('Stream step update received', {
      executionId,
      taskId,
      status,
      scope,
      parentIteratorId,
      iterationIndex,
      rawStatus: update?.status || '',
      resultStatus: update?.result?.status || '',
    });

    if (isIteratorChildUpdate) {
      const grpcComps = result?.components || [];
      const components = mapGrpcComponents(grpcComps, taskId);
      const output = extractTextFromComponents(grpcComps);
      const toolTrace = this.mapGrpcToolTrace(result?.tool_trace || []);
      const llmPromptTrace = this.mapGrpcLlmPromptTrace(result?.llm_prompt_trace || []);
      const artifacts = mapGrpcTaskArtifacts(result?.artifacts);
      const eventBase = {
        executionId,
        parentIteratorId,
        iterationIndex,
        taskId,
        taskTitle: normalizedUpdate?.task_title || '',
      };

      if (status === 'in_progress') {
        if (result && (grpcComps.length > 0 || toolTrace.length > 0 || llmPromptTrace.length > 0 || artifacts.length > 0)) {
          this.streamGateway.sendToUser(userId, {
            type: 'playbook_iterator_child_step_update',
            data: {
              ...eventBase,
              status: 'running',
              output: output || '',
              components,
              artifacts,
              toolTrace,
              llmPromptTrace,
            },
          });
        } else {
          this.streamGateway.sendToUser(userId, {
            type: 'playbook_iterator_child_step_start',
            data: { ...eventBase, status: 'running' },
          });
        }
        return;
      }

      if (status === 'completed' || status === 'failed' || status === 'skipped') {
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_iterator_child_step_complete',
          data: {
            ...eventBase,
            status,
            output: output || '',
            error: result?.error || '',
            durationMs: parseInt(result?.duration_ms || '0', 10),
            components,
            artifacts,
            toolTrace,
            llmPromptTrace,
          },
        });
        return;
      }
    }

    switch (status) {
      case 'in_progress': {
        const existing = stepBuffer.get(taskId);
        const grpcComps = result?.components || [];
        const components = mapGrpcComponents(grpcComps, taskId);
        const output = extractTextFromComponents(grpcComps);
        const toolTrace = this.mapGrpcToolTrace(result?.tool_trace || []);
        const llmPromptTrace = this.mapGrpcLlmPromptTrace(result?.llm_prompt_trace || []);
        const grpcArtifacts = mapGrpcTaskArtifacts(result?.artifacts);
        const activeTask = taskMap.get(taskId);
        const emittedPayloadArtifacts = mapGrpcPortPayloads(result?.emitted_payloads);
        const artifacts = this.mergeTaskArtifacts(
          grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(activeTask, grpcComps),
          emittedPayloadArtifacts,
        );

        stepBuffer.set(taskId, {
          taskId,
          status: StepStatus.RUNNING,
          startedAt: existing?.startedAt || new Date(),
          output: output || existing?.output,
          components: components.length > 0 ? components : existing?.components,
          toolTrace: toolTrace.length > 0 ? toolTrace : existing?.toolTrace,
          llmPromptTrace: llmPromptTrace.length > 0 ? llmPromptTrace : existing?.llmPromptTrace,
          artifacts: artifacts.length > 0 ? artifacts : existing?.artifacts,
        });

        if (
          result &&
          (grpcComps.length > 0 ||
            toolTrace.length > 0 ||
            llmPromptTrace.length > 0 ||
            artifacts.length > 0)
        ) {
          this.streamGateway.sendToUser(userId, {
            type: 'playbook_step_update',
            data: {
              executionId,
              taskId,
              status: 'running',
              output: output || '',
              components,
              artifacts,
              toolTrace,
              llmPromptTrace,
            },
          });
        } else {
          this.streamGateway.sendToUser(userId, {
            type: 'playbook_step_start',
            data: { executionId, taskId, status: 'running' },
          });
        }
        break;
      }

      case 'completed': {
        const grpcComps = result?.components || [];
        const components = mapGrpcComponents(grpcComps, taskId);
        const toolTrace = this.mapGrpcToolTrace(result?.tool_trace || []);
        const llmPromptTrace = this.mapGrpcLlmPromptTrace(result?.llm_prompt_trace || []);
        const semanticMatch = this.mapGrpcSemanticMatch(result?.semantic_match);
        const output = extractTextFromComponents(grpcComps);
        const durationMs = parseInt(result?.duration_ms || '0', 10);
        const existing = stepBuffer.get(taskId);
        const completedTask = taskMap.get(taskId);
        const grpcArtifacts = mapGrpcTaskArtifacts(result?.artifacts);
        const emittedPayloadArtifacts = mapGrpcPortPayloads(result?.emitted_payloads);
        const iteratorIterations = mapGrpcIteratorIterations(result?.iterator_iterations);
        const artifacts = this.mergeTaskArtifacts(
          grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(completedTask, grpcComps),
          emittedPayloadArtifacts,
        );

        const usage = result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        stepBuffer.set(taskId, {
          taskId,
          status: StepStatus.COMPLETED,
          output,
          components,
          toolTrace,
          llmPromptTrace,
          semanticMatch,
          durationMs,
          startedAt: existing?.startedAt || new Date(),
          completedAt: new Date(),
          artifacts,
          iteratorIterations,
          artifactsByPort: this.groupArtifactsByPort(artifacts),
          ...usageFields,
        } as any);
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'completed',
            output,
            components,
            artifacts,
            iteratorIterations,
            toolTrace,
            llmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('SSE playbook_step_complete sent (workflow)', {
          executionId,
          taskId,
          status: 'completed',
        });
        if (completedTask?.taskType === 'evaluation') {
          void this.evaluationService.persistEvaluationExecution({
            playbookId,
            executionId,
            task: completedTask,
            artifacts,
            durationMs,
            completedAt: new Date(),
            modelName: usageFields.modelName ?? null,
          });
        }
        break;
      }

      case 'failed': {
        const grpcComps = result?.components || [];
        const components = mapGrpcComponents(grpcComps, taskId);
        const toolTrace = this.mapGrpcToolTrace(result?.tool_trace || []);
        const llmPromptTrace = this.mapGrpcLlmPromptTrace(result?.llm_prompt_trace || []);
        const semanticMatch = this.mapGrpcSemanticMatch(result?.semantic_match);
        const error = result?.error || 'Step failed';
        const durationMs = parseInt(result?.duration_ms || '0', 10);
        const existing = stepBuffer.get(taskId);
        const failedTask = taskMap.get(taskId);
        const grpcArtifacts = mapGrpcTaskArtifacts(result?.artifacts);
        const emittedPayloadArtifacts = mapGrpcPortPayloads(result?.emitted_payloads);
        const iteratorIterations = mapGrpcIteratorIterations(result?.iterator_iterations);
        const artifacts = this.mergeTaskArtifacts(
          grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(failedTask, grpcComps),
          emittedPayloadArtifacts,
        );

        const usage = result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        stepBuffer.set(taskId, {
          taskId,
          status: StepStatus.FAILED,
          error,
          components,
          toolTrace,
          llmPromptTrace,
          semanticMatch,
          durationMs,
          startedAt: existing?.startedAt || new Date(),
          completedAt: new Date(),
          artifacts,
          iteratorIterations,
          artifactsByPort: this.groupArtifactsByPort(artifacts),
          ...usageFields,
        } as any);
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'failed',
            error,
            artifacts,
            iteratorIterations,
            components,
            toolTrace,
            llmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('SSE playbook_step_complete sent (workflow)', {
          executionId,
          taskId,
          status: 'failed',
          error,
        });
        if (failedTask)
          this.notificationService.sendStepNotificationEmail(failedTask, 'failed', playbookName, { error });
        break;
      }

      case 'skipped': {
        const grpcComps = result?.components || [];
        const components = mapGrpcComponents(grpcComps, taskId);
        const toolTrace = this.mapGrpcToolTrace(result?.tool_trace || []);
        const llmPromptTrace = this.mapGrpcLlmPromptTrace(result?.llm_prompt_trace || []);
        const semanticMatch = this.mapGrpcSemanticMatch(result?.semantic_match);
        const durationMs = parseInt(result?.duration_ms || '0', 10);
        const existing = stepBuffer.get(taskId);
        const skippedTask = taskMap.get(taskId);
        const grpcArtifacts = mapGrpcTaskArtifacts(result?.artifacts);
        const emittedPayloadArtifacts = mapGrpcPortPayloads(result?.emitted_payloads);
        const iteratorIterations = mapGrpcIteratorIterations(result?.iterator_iterations);
        const artifacts = this.mergeTaskArtifacts(
          grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(skippedTask, grpcComps),
          emittedPayloadArtifacts,
        );

        const usage = result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        stepBuffer.set(taskId, {
          taskId,
          status: StepStatus.SKIPPED,
          output: '',
          components,
          toolTrace,
          llmPromptTrace,
          semanticMatch,
          durationMs,
          startedAt: existing?.startedAt || new Date(),
          completedAt: new Date(),
          iteratorIterations,
          ...usageFields,
        });
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'skipped',
            output: '',
            artifacts,
            iteratorIterations,
            components,
            toolTrace,
            llmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('SSE playbook_step_complete sent (workflow)', {
          executionId,
          taskId,
          status: 'skipped',
        });
        break;
      }

      case 'suspended': {
        const existing = stepBuffer.get(taskId);
        if (existing) {
          // Preserve completed data (output, components, durationMs) Ã¢â‚¬â€ only update status
          existing.status = StepStatus.RUNNING;
        } else {
          stepBuffer.set(taskId, {
            taskId,
            status: StepStatus.RUNNING,
            startedAt: new Date(),
          });
        }
        break;
      }
    }
  }

  private async handleStreamInterrupts(
    userId: string,
    executionId: string,
    interrupts: Array<{ interrupt: any; threadId: string }>,
    taskMap: Map<string, any> = new Map(),
    playbookName: string = '',
    playbookId: string = '',
  ): Promise<void> {
    const threadId = interrupts[0]?.threadId || '';

    for (const { interrupt } of interrupts) {
      const interruptTaskId = interrupt?.task_id || '';
      if (interruptTaskId) {
        await this.appendHumanFeedbackComponent(executionId, interruptTaskId, {
          interruptType: interrupt?.type || 'unknown',
          message: interrupt?.message || '',
          taskDescription: interrupt?.task_description || '',
          result: interrupt?.result || '',
          status: 'pending',
          interruptId: interrupt?.interrupt_id || '',
          round: interrupt?.round || 0,
          payloadJson: interrupt?.conversation_json || '',
          resumableActions: interrupt?.resumable_actions || [],
        });
      }

      this.streamGateway.sendToUser(userId, {
        type: 'playbook_interrupt',
        data: {
          executionId,
          taskId: interruptTaskId,
          type: interrupt?.type || 'unknown',
          message: interrupt?.message || '',
          threadId,
          interruptId: interrupt?.interrupt_id || '',
          round: interrupt?.round || 0,
          payloadJson: interrupt?.conversation_json || '',
          resumableActions: interrupt?.resumable_actions || [],
          taskDescription: interrupt?.task_description || '',
          result: interrupt?.result || '',
        },
      });

      const interruptTask = taskMap.get(interruptTaskId);
      if (interruptTask) {
        this.notificationService.sendStepNotificationEmail(interruptTask, 'interrupted', playbookName, {
          output: interrupt?.message || 'Awaiting human input',
          playbookId,
          executionId,
        });
      }
    }

    const firstInterrupt = interrupts[0]?.interrupt;
    await this.recordPendingInterrupt(executionId, firstInterrupt, threadId || firstInterrupt?.thread_id || '');
  }

  /**
   * Shared stream consumer Ã¢â‚¬â€ used by both runFullWorkflow and resume.
   * Collects step updates, detects suspended interrupts, handles completion.
   */
  private async consumePlaybookStream(
    userId: string,
    executionId: string,
    call: grpc.ClientReadableStream<any>,
    startedAt: Date,
    resumedTaskId?: string,
    resumedInterruptIdentity?: { interruptId?: string; type?: string; round?: number },
    taskMap: Map<string, any> = new Map(),
    playbookName: string = '',
    playbookId: string = '',
  ): Promise<void> {
    const stepBuffer = new Map<string, BufferedStepResult>();
    this.bufferService.activeStepBuffers.set(executionId, stepBuffer);
    const suspendedInterrupts: Array<{ interrupt: any; threadId: string }> = [];
    let streamThreadId = '';

    let evalEnabled = false;
    let reflectionEnabled = true;
    try {
      const execRecord = await this.executionModel
        .findById(executionId)
        .select('runEvaluation reflectionEnabled')
        .lean()
        .exec();
      evalEnabled = execRecord?.runEvaluation === true;
      reflectionEnabled = execRecord?.reflectionEnabled !== false;
    } catch {
      // Default to false on error
    }

    const timeoutMs = this.grpcService.workflowTimeoutMs;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const resetIdleTimeout = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        this.logger.error('Workflow stream idle timeout', { executionId, timeoutMs });
        call.cancel();
      }, timeoutMs);
    };

    resetIdleTimeout();

    this.grpcService.registerStream(executionId, call);

    const earlyEvaluatedTaskIds = new Set<string>();
    const earlyFlushPromises = new Map<string, Promise<void>>();

    return new Promise<void>((resolve, reject) => {
      call.on('data', (chunk: any) => {
        resetIdleTimeout();

        if (chunk.thread_id) streamThreadId = chunk.thread_id;

        if (chunk.step_update) {
          const normalizedUpdate = this.normalizeStreamStepUpdate(chunk.step_update);
          try {
            this.handleStepUpdate(
              userId,
              executionId,
              normalizedUpdate,
              stepBuffer,
              taskMap,
              playbookName,
              evalEnabled,
              reflectionEnabled,
            );
          } catch (err) {
            this.logger.error('handleStepUpdate threw', {
              executionId,
              taskId: normalizedUpdate.task_id,
              error: (err as Error).message,
              stack: (err as Error).stack,
            });
            call.cancel();
            reject(err);
            return;
          }

          if (normalizedUpdate.status === 'completed') {
            const completedTaskId = normalizedUpdate.task_id;
            const capturedBuffered = stepBuffer.get(completedTaskId);
            if (capturedBuffered && capturedBuffered.status === StepStatus.COMPLETED) {
              const flushPromise = this.bufferService
                .flushBufferedTaskResult(executionId, completedTaskId, capturedBuffered as any, [])
                .then(() => {
                  earlyEvaluatedTaskIds.add(completedTaskId);
                  this.scheduleSemanticEvaluation(
                    userId,
                    executionId,
                    completedTaskId,
                    'completed',
                    evalEnabled,
                  );
                  const taskEntry = taskMap.get(completedTaskId);
                  this.scheduleNodeReflection(
                    userId,
                    executionId,
                    completedTaskId,
                    'completed',
                    reflectionEnabled && !taskEntry?.disableAdvisorEvaluation,
                  );
                })
                .catch((err: unknown) => {
                  this.logger.warn('Per-step evaluation flush failed', {
                    executionId,
                    taskId: completedTaskId,
                    error: err instanceof Error ? err.message : 'Unknown error',
                  });
                });
              earlyFlushPromises.set(completedTaskId, flushPromise);
            }
          }

          if (normalizedUpdate.status === 'suspended' && normalizedUpdate.interrupt) {
            const interruptTaskId = normalizedUpdate.interrupt.task_id || normalizedUpdate.task_id;
            const sameTask = resumedTaskId && interruptTaskId === resumedTaskId;
            const interruptId = normalizedUpdate.interrupt.interrupt_id || '';
            const interruptType = normalizedUpdate.interrupt.type || '';
            const interruptRound = normalizedUpdate.interrupt.round || 0;
            const sameInterrupt =
              !!sameTask &&
              ((resumedInterruptIdentity?.interruptId &&
                interruptId === resumedInterruptIdentity.interruptId) ||
                (!resumedInterruptIdentity?.interruptId &&
                  interruptType === (resumedInterruptIdentity?.type || '') &&
                  interruptRound === (resumedInterruptIdentity?.round || 0)));

            if (sameInterrupt) {
              this.logger.debug('Skipping stale re-emitted interrupt for resumed task', {
                executionId,
                resumedTaskId,
                interruptType,
                interruptId,
                interruptRound,
              });
            } else {
              suspendedInterrupts.push({
                interrupt: normalizedUpdate.interrupt,
                threadId: streamThreadId || normalizedUpdate.interrupt.thread_id || '',
              });
            }
          }
        }
      });

      call.on('end', async () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.grpcService.removeStream(executionId);
        try {
          await this.bufferService.flushStepBuffer(executionId, stepBuffer, async (taskId, buffered) => {
            if (buffered.status !== StepStatus.COMPLETED) {
              return;
            }
            const inFlight = earlyFlushPromises.get(taskId);
            if (inFlight) {
              await inFlight;
            }
            if (earlyEvaluatedTaskIds.has(taskId)) {
              return;
            }
            this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', evalEnabled);
            const taskEntry = taskMap.get(taskId);
            this.scheduleNodeReflection(
              userId,
              executionId,
              taskId,
              'completed',
              reflectionEnabled && !taskEntry?.disableAdvisorEvaluation,
            );
          });
          this.bufferService.activeStepBuffers.delete(executionId);
          await this.bufferService.recordStreamUsage(userId, executionId, stepBuffer, startedAt);

          const wasCancelled = this.grpcService.wasCancelled(executionId);
          if (wasCancelled) {
            await this.markExecutionCancelled(userId, executionId, startedAt);
            resolve();
            return;
          }

          const resumedBuffered = resumedTaskId ? stepBuffer.get(resumedTaskId) : undefined;
          const resumedNeedsCompletion =
            resumedTaskId && (!resumedBuffered || resumedBuffered.status === StepStatus.RUNNING);
          if (resumedTaskId && resumedNeedsCompletion) {
            this.logger.debug('Resumed task had no stream update, sending completion from DB', {
              executionId,
              resumedTaskId,
            });
            const freshExec = await this.executionModel
              .findById(executionId)
              .select('taskResults')
              .lean()
              .exec();
            const resumedTr = freshExec?.taskResults.find((tr: any) => tr.taskId === resumedTaskId);
            if (resumedTr) {
              const trAny = resumedTr as any;
              this.streamGateway.sendToUser(userId, {
                type: 'playbook_step_complete',
                data: {
                  executionId,
                  taskId: resumedTaskId,
                  status: trAny.status || 'completed',
                  output: trAny.output || null,
                  error: trAny.error || null,
                  components: trAny.components || [],
                  toolTrace: trAny.toolTrace || [],
                  llmPromptTrace: trAny.llmPromptTrace || [],
                  durationMs: trAny.durationMs || null,
                  semanticMatch: trAny.semanticMatch ?? null,
                  artifacts: trAny.artifacts ?? undefined,
                  ...(trAny.inputTokens != null ? { inputTokens: trAny.inputTokens } : {}),
                  ...(trAny.outputTokens != null ? { outputTokens: trAny.outputTokens } : {}),
                  ...(trAny.totalTokens != null ? { totalTokens: trAny.totalTokens } : {}),
                  ...(trAny.modelName != null ? { modelName: trAny.modelName } : {}),
                },
              });
            }
          }

          if (suspendedInterrupts.length > 0) {
            await this.handleStreamInterrupts(
              userId,
              executionId,
              suspendedInterrupts,
              taskMap,
              playbookName,
              playbookId,
            );
          } else {
            const freshExecCheck = await this.executionModel
              .findById(executionId)
              .select('taskResults')
              .lean()
              .exec();

            const iteratorChildTaskIds = new Set<string>();
            for (const [id, t] of taskMap) {
              if (t?.containerConfig?.parentIteratorId) {
                iteratorChildTaskIds.add(id);
              }
            }

            const runningIteratorChildren = (freshExecCheck?.taskResults || []).filter(
              (tr: any) =>
                iteratorChildTaskIds.has(tr.taskId) &&
                tr.status === StepStatus.RUNNING,
            );
            const nonIteratorPendingOrRunning = (freshExecCheck?.taskResults || []).filter(
              (tr: any) =>
                (tr.status === StepStatus.PENDING || tr.status === StepStatus.RUNNING) &&
                !iteratorChildTaskIds.has(tr.taskId),
            );

            const genuinelyPendingOrRunning = [
              ...nonIteratorPendingOrRunning,
              ...runningIteratorChildren,
            ];

            if (genuinelyPendingOrRunning.length > 0) {
              this.logger.warn('Stream ended prematurely with tasks still pending/running', {
                executionId,
                pendingRunningTaskIds: genuinelyPendingOrRunning.map((tr: any) => tr.taskId),
              });
              await this.markRemainingSkippedAndFail(
                userId,
                executionId,
                'Stream ended unexpectedly before all tasks completed',
                startedAt,
              );
            } else {
              const staleIteratorChildren = (freshExecCheck?.taskResults || []).filter(
                (tr: any) =>
                  iteratorChildTaskIds.has(tr.taskId) &&
                  tr.status === StepStatus.PENDING,
              );
              if (staleIteratorChildren.length > 0) {
                const childIds = staleIteratorChildren.map((tr: any) => tr.taskId);
                await this.executionModel.updateOne(
                  { _id: executionId },
                  {
                    $set: {
                      'taskResults.$[elem].status': StepStatus.COMPLETED,
                      'taskResults.$[elem].completedAt': new Date(),
                    },
                  },
                  { arrayFilters: [{ 'elem.taskId': { $in: childIds } }] },
                );
                this.logger.debug('Auto-completed stale iterator child tasks', {
                  executionId,
                  childTaskIds: childIds,
                });
              }
              await this.markExecutionCompleted(userId, executionId, startedAt);
            }
          }
          resolve();
        } catch (err) {
          this.logger.error('Error finalizing workflow', {
            executionId,
            error: (err as Error).message,
          });
          reject(err);
        }
      });

      call.on('error', (err: Error) => {
        void (async () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          this.grpcService.removeStream(executionId);

          const wasCancelled = this.grpcService.wasCancelled(executionId);
          if (wasCancelled) {
            await this.bufferService.flushStepBuffer(executionId, stepBuffer);
            this.bufferService.activeStepBuffers.delete(executionId);
            await this.markExecutionCancelled(userId, executionId, startedAt);
            resolve();
            return;
          }

          this.logger.error('Workflow stream error', {
            executionId,
            error: err.message,
          });
          await this.bufferService.flushStepBuffer(executionId, stepBuffer);
          this.bufferService.activeStepBuffers.delete(executionId);
          await this.markRemainingSkippedAndFail(userId, executionId, err.message, startedAt);
          reject(err);
        })().catch(async (handlerErr: unknown) => {
          this.logger.error('Workflow stream error handler failed', {
            executionId,
            error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
          });
          try {
            this.bufferService.activeStepBuffers.delete(executionId);
            await this.markRemainingSkippedAndFail(
              userId,
              executionId,
              handlerErr instanceof Error ? handlerErr.message : err.message,
              startedAt,
            );
          } catch (finalizeErr) {
            this.logger.error('Failed to finalize workflow stream error handler', {
              executionId,
              error: finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr),
            });
          }
          reject(handlerErr instanceof Error ? handlerErr : err);
        });
      });
    });
  }

  private async runExecutionLoop(
    userId: string,
    executionId: string,
    orderedLevels: any[][],
    grpcAgentMap: Map<string, IGrpcAgent>,
    dto: ExecutePlaybookDto,
    effectiveModes: Map<string, string>,
    streamingEnabled: boolean = false,
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [],
    userEmail: string = '',
    playbookName: string = '',
    activeReplayMap: Map<string, any> = new Map(),
    initialTaskOutputs: Map<string, string> = new Map(),
  ): Promise<void> {
    this.logger.debug('runExecutionLoop start', {
      executionId,
      userId,
      levelCount: orderedLevels.length,
      totalTasks: orderedLevels.reduce((sum, lvl) => sum + lvl.length, 0),
    });

    const execution = await this.executionModel
      .findById(executionId)
      .select(
        'taskResults.taskId taskResults.status playbookSnapshot playbookId startedAt runEvaluation triggerContext',
      )
      .lean()
      .exec();
    if (!execution) {
      this.logger.warn('runExecutionLoop: execution not found', { executionId });
      return;
    }

    const taskOutputs = new Map<string, string>(initialTaskOutputs);
    const snapshot = execution.playbookSnapshot as any;
    const playbookId = execution.playbookId.toString();
    const startedAt = execution.startedAt!;

    let levelIndex = 0;
    for (const level of orderedLevels) {
      // Filter out already-skipped tasks (e.g. singleStepTaskId mode)
      const runnableTasks = level.filter((task) => {
        const tr = execution.taskResults.find((r: any) => r.taskId === task.id);
        return tr && tr.status !== StepStatus.SKIPPED;
      });

      if (runnableTasks.length === 0) {
        this.logger.debug('Skipping empty level', { executionId, levelIndex });
        levelIndex++;
        continue;
      }

      this.logger.debug('Executing level', {
        executionId,
        levelIndex,
        taskCount: runnableTasks.length,
        taskIds: runnableTasks.map((t: any) => t.id),
      });

      // Execute all tasks in this level with concurrency limit
      const limiter = pLimit(this.maxConcurrentSteps);
      const results = await Promise.allSettled(
        runnableTasks.map((task) =>
          limiter(() =>
            this.executeStep(
              userId,
              executionId,
              playbookId,
              task,
              grpcAgentMap,
              taskOutputs,
              snapshot,
              workspaceContexts,
              userEmail,
              playbookName,
              effectiveModes.get(task.id) || 'live',
              activeReplayMap.get(task.id) || null,
              (execution as any).runEvaluation === true,
              (execution as any).reflectionEnabled !== false,
              streamingEnabled,
              (execution as any).triggerContext ?? null,
            ),
          ),
        ),
      );

      // Collect outcomes
      let hasFailure = false;
      let interruptResult: { task: any; response: any } | null = null;
      const errors: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          hasFailure = true;
          errors.push((result.reason as Error).message);
        } else {
          const outcome = result.value;
          if (outcome.outcome === 'failed') {
            hasFailure = true;
            errors.push(outcome.error || 'Step failed');
          } else if (outcome.outcome === 'interrupted') {
            interruptResult = { task: runnableTasks[i], response: outcome.response };
          }
          // For completed: taskOutputs already populated in executeStep
        }
      }

      this.logger.debug('Level execution results', {
        executionId,
        levelIndex,
        hasFailure,
        hasInterrupt: !!interruptResult,
        errorCount: errors.length,
      });

      // Failure takes precedence over interrupt
      if (hasFailure) {
        this.logger.warn('Level had failures, marking execution failed', {
          executionId,
          levelIndex,
          errors,
        });
        await this.markRemainingSkippedAndFail(userId, executionId, errors.join('; '), startedAt);
        return;
      }

      if (interruptResult) {
        const response = interruptResult.response;
        const interrupt = response.interrupt;
        this.logger.debug('Level interrupted', {
          executionId,
          levelIndex,
          taskId: interruptResult.task.id,
          interruptType: interrupt?.type,
          threadId: response.thread_id,
        });

        await this.recordPendingInterrupt(
          executionId,
          interrupt,
          response.thread_id || interrupt?.thread_id || '',
        );

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_interrupt',
          data: {
            executionId,
            taskId: interruptResult.task.id,
            type: interrupt?.type || 'unknown',
            message: interrupt?.message || '',
            threadId: response.thread_id || '',
          },
        });
        this.logger.debug('SSE playbook_interrupt sent (loop)', {
          executionId,
          taskId: interruptResult.task.id,
        });
        return;
      }
      levelIndex++;
    }

    // All levels completed
    this.logger.debug('All levels completed', { executionId });
    await this.markExecutionCompleted(userId, executionId, startedAt);
  }

  private async runSingleStepAdvisorAutopilot(
    userId: string,
    executionId: string,
    playbook: any,
    initialTask: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [],
    userEmail: string,
    initialExecutionMode: string,
    initialValidatedReplay: any,
    streamingEnabled: boolean,
    autopilot: AdvisorAutopilotConfig,
  ): Promise<void> {
    const taskId = initialTask.id;
    let task = initialTask;
    let selectedExecutionMode = initialExecutionMode;
    let validatedReplay = initialValidatedReplay;
    let remediationTurn = 0;
    let previousScore: number | null = null;

    const initialExecution = await this.executionModel
      .findById(executionId)
      .select(
        'playbookId playbookSnapshot startedAt runEvaluation reflectionEnabled currentAttemptNumber triggerContext',
      )
      .lean()
      .exec();
    if (!initialExecution) {
      return;
    }

    let snapshot = initialExecution.playbookSnapshot as any;
    let taskOutputs = new Map<string, string>();
    const startedAt = initialExecution.startedAt
      ? new Date(initialExecution.startedAt)
      : new Date();

    while (true) {
      const outcome = await this.executeStep(
        userId,
        executionId,
        playbook._id.toString(),
        task,
        grpcAgentMap,
        taskOutputs,
        snapshot,
        workspaceContexts,
        userEmail,
        playbook.name,
        selectedExecutionMode,
        validatedReplay,
        initialExecution.runEvaluation === true,
        false,
        streamingEnabled,
        (initialExecution as any).triggerContext ?? null,
      );

      if (outcome.outcome === 'interrupted') {
        const interrupt = outcome.response?.interrupt;
        await this.recordPendingInterrupt(
          executionId,
          interrupt,
          outcome.response?.thread_id || interrupt?.thread_id || '',
        );
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_interrupt',
          data: {
            executionId,
            taskId,
            type: interrupt?.type || 'unknown',
            message: interrupt?.message || '',
            threadId: outcome.response?.thread_id || '',
          },
        });
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: 'stopped',
          taskId,
          attemptCount: remediationTurn,
          lastError: null,
        });
        return;
      }

      if (outcome.outcome === 'failed') {
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: 'failed',
          taskId,
          attemptCount: remediationTurn,
          lastError: outcome.error || 'Step failed',
        });
        await this.markRemainingSkippedAndFail(
          userId,
          executionId,
          outcome.error || 'Step failed',
          startedAt,
        );
        return;
      }

      await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
        status: 'judging',
        taskId,
        attemptCount: remediationTurn,
        lastError: null,
      });

      try {
        await this.judgeEnrichmentService.evaluateNodeNow(userId, executionId, taskId);
        await this.judgeEnrichmentService.evaluateExecutionSummaryNowIfReady(userId, executionId);
      } catch (error) {
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: 'failed',
          taskId,
          attemptCount: remediationTurn,
          lastError: error instanceof Error ? error.message : 'Advisor evaluation failed',
        });
        await this.advisorService.appendAdvisorTurnHistory(userId, executionId, taskId, {
          turn: remediationTurn,
          score: previousScore,
          recommendation: null,
          safeAutoFixType: null,
          actionType: 'stop',
          stopReason: 'advisor_evaluation_failed',
          scoreDelta: null,
        });
        await this.markExecutionCompleted(userId, executionId, startedAt);
        return;
      }

      const taskResult = await this.advisorService.getExecutionTaskResult(executionId, taskId);
      const judgeResult = taskResult?.judgeResult || null;
      const currentScore = judgeResult?.overallScore ?? null;
      const scoreDelta =
        previousScore !== null && currentScore !== null ? currentScore - previousScore : null;
      const effectiveSafeAutoFixType = this.advisorService.resolveAdvisorAutopilotFixType(judgeResult);

      await this.advisorService.appendAdvisorTurnHistory(userId, executionId, taskId, {
        turn: remediationTurn,
        score: currentScore,
        recommendation: judgeResult?.recommendation ?? null,
        safeAutoFixType: effectiveSafeAutoFixType,
        actionType: 'evaluate',
        scoreDelta,
      });

      if (!judgeResult) {
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: 'failed',
          taskId,
          attemptCount: remediationTurn,
          lastError: 'Advisor evaluation did not produce a result',
        });
        await this.advisorService.appendAdvisorTurnHistory(userId, executionId, taskId, {
          turn: remediationTurn,
          score: currentScore,
          recommendation: null,
          safeAutoFixType: null,
          actionType: 'stop',
          stopReason: 'advisor_evaluation_failed',
          scoreDelta,
        });
        await this.markExecutionCompleted(userId, executionId, startedAt);
        return;
      }

      const stopReason =
        judgeResult.overallScore > autopilot.targetScore
          ? 'target_reached'
          : remediationTurn >= autopilot.maxTurns
            ? 'max_turns_reached'
            : effectiveSafeAutoFixType !== 'optimize_step'
              ? judgeResult.recommendation === 'none'
                ? 'advisor_abstained'
                : 'no_safe_fix_available'
              : null;

      if (stopReason) {
        await this.advisorService.appendAdvisorTurnHistory(userId, executionId, taskId, {
          turn: remediationTurn,
          score: currentScore,
          recommendation: judgeResult.recommendation,
          safeAutoFixType: effectiveSafeAutoFixType,
          actionType: 'stop',
          stopReason,
          scoreDelta,
        });
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: stopReason === 'target_reached' ? 'completed' : 'stopped',
          taskId,
          attemptCount: remediationTurn,
          lastError: null,
        });
        await this.markExecutionCompleted(userId, executionId, startedAt);
        return;
      }

      remediationTurn += 1;
      await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
        status: 'optimizing',
        taskId,
        attemptCount: remediationTurn,
        lastError: null,
      });
      await this.advisorService.appendAdvisorTurnHistory(userId, executionId, taskId, {
        turn: remediationTurn,
        score: currentScore,
        recommendation: judgeResult.recommendation,
        safeAutoFixType: effectiveSafeAutoFixType,
        actionType: 'optimize_step',
        scoreDelta,
      });

      await this.judgeEnrichmentService.optimizeStep(
        userId,
        playbook._id.toString(),
        executionId,
        taskId,
      );
      const latestPlaybook = await this.playbookService.findRawById(playbook._id.toString());
      if (!latestPlaybook) {
        throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
      }

      const executionForRetry = await this.executionModel
        .findById(executionId)
        .select('playbookSnapshot currentAttemptNumber')
        .lean()
        .exec();
      if (!executionForRetry) {
        throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
      }
      snapshot = this.graphService.refreshSnapshotTask(
        executionForRetry.playbookSnapshot as any,
        latestPlaybook,
        taskId,
      );
      await this.executionModel
        .findByIdAndUpdate(executionId, { $set: { playbookSnapshot: snapshot } })
        .exec();

      const nextAttemptNumber = (executionForRetry.currentAttemptNumber ?? 1) + 1;
      await this.prepareExecutionForRerun(executionId, taskId, nextAttemptNumber);
      await this.resetTaskForAttempt(executionId, taskId, nextAttemptNumber);
      await this.appendAttemptHistory(executionId, nextAttemptNumber, 'rerun_step', taskId, null);
      await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
        status: 'rerunning',
        taskId,
        attemptCount: remediationTurn,
        lastError: null,
      });

      const taskMap = this.graphService.buildTaskMapFromSnapshot(snapshot);
      task = taskMap.get(taskId);
      selectedExecutionMode = (task as any)?.stepReplayMode || selectedExecutionMode;
      validatedReplay =
        selectedExecutionMode !== 'live'
          ? await this.replayService.getActiveReplay(playbook._id.toString(), taskId)
          : null;
      previousScore = currentScore;
      taskOutputs = new Map<string, string>();
    }
  }

  private async runSingleStepExecution(
    userId: string,
    executionId: string,
    playbook: any,
    task: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [],
    userEmail: string,
    executionMode: string,
    validatedReplay: any,
    streamingEnabled: boolean,
    runEvaluation: boolean,
    runNodeReflection: boolean,
  ): Promise<void> {
    const execution = await this.executionModel
      .findById(executionId)
      .select('playbookSnapshot startedAt triggerContext')
      .lean()
      .exec();
    if (!execution) {
      return;
    }

    const startedAt = execution.startedAt ? new Date(execution.startedAt) : new Date();
    const outcome = await this.executeStep(
      userId,
      executionId,
      playbook._id.toString(),
      task,
      grpcAgentMap,
      new Map<string, string>(),
      execution.playbookSnapshot as any,
      workspaceContexts,
      userEmail,
      playbook.name,
      executionMode,
      validatedReplay,
      runEvaluation,
      false,
      streamingEnabled,
      (execution as any).triggerContext ?? null,
    );

    if (outcome.outcome === 'completed') {
      if (runNodeReflection && !task.disableAdvisorEvaluation) {
        try {
          await this.judgeEnrichmentService.evaluateNodeNow(userId, executionId, task.id);
          await this.judgeEnrichmentService.evaluateExecutionSummaryNowIfReady(userId, executionId);
        } catch (error) {
          this.logger.warn('Single-step advisor evaluation failed after step completion', {
            executionId,
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
      await this.markExecutionCompleted(userId, executionId, startedAt);
      return;
    }

    if (outcome.outcome === 'skipped') {
      await this.markExecutionCompleted(userId, executionId, startedAt);
      return;
    }

    if (outcome.outcome === 'interrupted') {
      const interrupt = outcome.response?.interrupt;
      await this.recordPendingInterrupt(
        executionId,
        interrupt,
        outcome.response?.thread_id || interrupt?.thread_id || '',
      );
      this.streamGateway.sendToUser(userId, {
        type: 'playbook_interrupt',
        data: {
          executionId,
          taskId: task.id,
          type: interrupt?.type || 'unknown',
          message: interrupt?.message || '',
          threadId: outcome.response?.thread_id || '',
        },
      });
      return;
    }

    await this.markRemainingSkippedAndFail(
      userId,
      executionId,
      outcome.error || 'Step failed',
      startedAt,
    );
  }

  /**
   * Execute a single step: SSE start -> DB update -> gather context -> gRPC -> SSE complete.
   * Returns the outcome so the caller can decide what to do.
   */
  private async executeStep(
    userId: string,
    executionId: string,
    playbookId: string,
    task: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    taskOutputs: Map<string, string>,
    snapshot: any,
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }> = [],
    userEmail: string = '',
    playbookName: string = '',
    executionMode: string = 'live',
    validatedReplay: any = null,
    runEvaluation: boolean = false,
    runNodeReflection: boolean = true,
    streamingEnabled: boolean = false,
    triggerContext: Record<string, unknown> | null = null,
  ): Promise<{
    outcome: 'completed' | 'failed' | 'interrupted' | 'skipped';
    error?: string;
    response?: any;
  }> {
    const taskId = task.id;

    this.logger.debug('executeStep start', {
      executionId,
      taskId,
      taskTitle: task.title,
      assignedAgentId: task.assignedAgentId?.toString() || null,
    });

    // SSE: step start
    this.streamGateway.sendToUser(userId, {
      type: 'playbook_step_start',
      data: { executionId, taskId, status: 'running' },
    });
    this.logger.debug('SSE playbook_step_start sent', { executionId, taskId });

    // DB: mark running
    await this.updateTaskResult(executionId, taskId, {
      status: StepStatus.RUNNING,
      startedAt: new Date(),
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
    });

    const contextFromDependencies = this.graphService.gatherContext(task, taskOutputs, snapshot);

    // Build gRPC request
    const grpcAgent = task.assignedAgentId
      ? grpcAgentMap.get(task.assignedAgentId.toString()) || null
      : null;

    const activeOutputFormat = await this.outputFormatService.getActiveTemplate(playbookId, taskId);

    // Build workspace_context: start with playbook workspaces, then merge task
    // input-file contexts on top so the playbook's default workspace is always first.
    let taskWorkspaceContexts = workspaceContexts;
    let inputFilesByPort: Array<{ port_id: string; document_ids: string[] }> = [];
    if (task.inputFiles && task.inputFiles.length > 0) {
      const fileContexts = await this.contextService.buildWorkspaceContextFromInputFiles(
        task.inputFiles,
      );
      inputFilesByPort = await this.contextService.extractDocumentIdsByPort(task.inputFiles);
      // Merge instead of replace: add input-file workspaces after playbook ones,
      // keeping the playbook default workspace at position 0.
      const existingIds = new Set(taskWorkspaceContexts.map((c) => c.workspace_id));
      const extraContexts = fileContexts.filter((c) => !existingIds.has(c.workspace_id));
      if (extraContexts.length) {
        taskWorkspaceContexts = [...taskWorkspaceContexts, ...extraContexts];
      }
      this.logger.debug('Merged task-level input files with playbook workspace_context', {
        executionId,
        taskId,
        inputFilesCount: task.inputFiles.length,
        playbookContextCount: workspaceContexts.length,
        extraContextCount: extraContexts.length,
        inputFilesByPortCount: inputFilesByPort.length,
      });
    }

    const currentExecutionState = await this.executionModel
      .findById(executionId)
      .select('taskResults')
      .lean()
      .exec();

    const upstreamPortInputs = this.graphService.buildWorkspaceContextFromUpstreamArtifacts(
      currentExecutionState,
      snapshot,
      taskId,
    );
    const routingState = this.graphService.buildRunStepRoutingState(currentExecutionState, snapshot, taskId);
    const nodeInputs = this.graphService.resolveNodeInputs(currentExecutionState, snapshot, taskId);
    if (
      upstreamPortInputs.workspaceContexts.length > 0 ||
      upstreamPortInputs.inputFilesByPort.length > 0
    ) {
      taskWorkspaceContexts = this.graphService.mergeWorkspaceContexts(
        taskWorkspaceContexts,
        upstreamPortInputs.workspaceContexts,
      );
      const byPort = new Map<string, Set<string>>();
      for (const entry of [...inputFilesByPort, ...upstreamPortInputs.inputFilesByPort]) {
        if (!byPort.has(entry.port_id)) {
          byPort.set(entry.port_id, new Set<string>());
        }
        for (const documentId of entry.document_ids || []) {
          byPort.get(entry.port_id)!.add(documentId);
        }
      }
      inputFilesByPort = Array.from(byPort.entries()).map(([port_id, ids]) => ({
        port_id,
        document_ids: Array.from(ids),
      }));
      this.logger.debug('Injected upstream port artifacts for step execution', {
        executionId,
        taskId,
        workspaceContextCount: taskWorkspaceContexts.length,
        inputFilesByPortCount: inputFilesByPort.length,
      });
    }

    const toolBindings = await this.buildGrpcToolBindings(
      task.toolBindings || [],
      grpcAgent?.connectorIds,
      userId,
    );
    const promptOverrides = await this.buildPromptOverrides();

    const grpcRequest: any = {
      user_context: { user_id: userId, username: userEmail },
      playbook_id: playbookId,
      task: {
        id: taskId,
        title: task.title,
        description: this.applyOutputFormatGuide(task.description || '', activeOutputFormat),
        assigned_agent_id: task.assignedAgentId?.toString() || '',
        execution_mode: task.executionMode || 'agent',
        selected_action: task.selectedAction || null,
        execution_order: task.executionOrder || 0,
        interrupt_before: task.interruptBefore || false,
        interrupt_after: task.interruptAfter || false,
        allow_clarification: task.allowClarification || false,
        clarification_prompt: task.clarificationPrompt || '',
        max_clarifications: task.maxClarifications || 3,
        input_keys: task.inputKeys || [],
        output_key: task.outputKey || '',
        input_files_by_port: inputFilesByPort,
        input_ports: (task.inputPorts || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          artifact_kind: p.artifactKind,
          required: p.required || false,
          description: p.description || '',
        })),
        output_ports: (task.outputPorts || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          artifact_kind: p.artifactKind,
          description: p.description || '',
        })),
        task_type: task.taskType || 'generic',
        evaluation_config: task.evaluationConfig
          ? {
              expectation: task.evaluationConfig.expectation || '',
              reference_baseline_id: task.evaluationConfig.referenceBaselineId || null,
              pass_threshold: task.evaluationConfig.passThreshold ?? 80,
              warning_threshold: task.evaluationConfig.warningThreshold ?? 60,
              weight: task.evaluationConfig.weight ?? 1,
              rubric_version: task.evaluationConfig.rubricVersion || 'evaluation-node-v1',
              weights: task.evaluationConfig.weights || {},
            }
          : null,
        tool_bindings: toolBindings,
      },
      context_from_dependencies: contextFromDependencies,
      workspace_context: taskWorkspaceContexts,
      execution_mode: executionMode,
      edges: routingState.edges,
      upstream_results: routingState.upstreamResults,
      node_inputs: this.portUnificationV2Enabled ? nodeInputs : [],
      declared_output_ports: this.portUnificationV2Enabled
        ? (task.outputPorts || []).map((p: any) => p.id)
        : [],
      prompt_overrides: promptOverrides,
    };

    if (triggerContext && typeof triggerContext === 'object') {
      grpcRequest.trigger_context = this.normalizeStructLike(triggerContext);
    }

    if (grpcAgent) {
      grpcRequest.agent = grpcAgent;
    }

    if (validatedReplay) {
      grpcRequest.validated_replay = this.formatReplayForGrpc({
        ...validatedReplay,
        preserveOutputFormat:
          activeOutputFormat?.generationStatus === 'ready'
            ? true
            : validatedReplay.preserveOutputFormat,
        outputFormatGuide:
          activeOutputFormat?.generationStatus === 'ready' && activeOutputFormat?.formatGuide
            ? activeOutputFormat.formatGuide
            : validatedReplay.outputFormatGuide,
      });
    }

    this.logger.debug('RunStep gRPC request built', {
      executionId,
      taskId,
      playbookId,
      hasAgent: !!grpcAgent,
      agentName: grpcAgent?.name || null,
      contextLength: contextFromDependencies.length,
      edgeCount: routingState.edges.length,
      upstreamResultCount: routingState.upstreamResults.length,
      workspaceContextSource:
        task.inputFiles && task.inputFiles.length > 0 ? 'task_inputFiles' : 'playbook_workspaces',
      workspaceContextCount: taskWorkspaceContexts.length,
      inputFilesByPort: inputFilesByPort,
      triggerContextPresent: !!grpcRequest.trigger_context,
      triggerContextKeys: triggerContext && typeof triggerContext === 'object'
        ? Object.keys(triggerContext as Record<string, unknown>)
        : [],
      triggerEdgeCount: routingState.edges.filter(
        (edge: any) => (edge.source_id || edge.sourceId) === '__trigger__',
      ).length,
    });
    this.logger.debug('RunStep gRPC request body', {
      executionId,
      taskId,
      request: JSON.stringify(grpcRequest),
    });

    if (streamingEnabled) {
      return this.executeStepWithStreaming(
        userId,
        executionId,
        playbookId,
        task,
        grpcRequest,
        taskOutputs,
        playbookName,
        runEvaluation,
        runNodeReflection,
      );
    }

    const stepStartTime = Date.now();
    try {
      const response = await this.grpcService.runStep(grpcRequest);
      const durationMs = Date.now() - stepStartTime;

      this.logger.debug('RunStep gRPC response received', {
        executionId,
        taskId,
        responseStatus: response.status,
        hasResult: !!response.result,
        componentCount: response.result?.components?.length || 0,
        hasInterrupt: !!response.interrupt,
        durationMs,
      });

      if (response.status === 'completed') {
        const grpcComps = response.result?.components || [];
        const components = mapGrpcComponents(grpcComps, taskId);
        const toolTrace = this.mapGrpcToolTrace(response.result?.tool_trace || []);
        const llmPromptTrace = this.mapGrpcLlmPromptTrace(response.result?.llm_prompt_trace || []);
        const semanticMatch = this.mapGrpcSemanticMatch(response.result?.semantic_match);
        const output = extractTextFromComponents(grpcComps);
        const grpcArtifacts = mapGrpcTaskArtifacts(response.result?.artifacts);
        const emittedPayloadArtifacts = mapGrpcPortPayloads(response.result?.emitted_payloads);
        const artifacts = this.mergeTaskArtifacts(
          grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(task, grpcComps),
          emittedPayloadArtifacts,
        );

        const usage = response.result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        await this.updateTaskResult(executionId, taskId, {
          status: StepStatus.COMPLETED,
          output,
          components,
          toolTrace,
          llmPromptTrace,
          semanticMatch,
          durationMs,
          completedAt: new Date(),
          isStale: false,
          staleReason: null,
          invalidatedByTaskId: null,
          artifacts,
          ...usageFields,
        });

        if (usage) {
          await this.executionModel.findByIdAndUpdate(executionId, {
            $inc: {
              totalInputTokens: usage.input_tokens || 0,
              totalOutputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
            },
          });
          this.usageService
            .recordUsage({
              userId,
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              usageType: UsageType.PLAYBOOK,
              modelName: usage.model || undefined,
              endpoint: 'playbook.executeStep',
              durationMs,
            })
            .catch((err) =>
              this.logger.warn('Failed to record usage', { error: (err as Error).message }),
            );
        }

        taskOutputs.set(taskId, output);
        if (task.outputKey) {
          taskOutputs.set(task.outputKey, output);
        }

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'completed',
            output,
            components,
            artifacts,
            toolTrace,
            llmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('Step completed', {
          executionId,
          taskId,
          componentCount: components.length,
          durationMs,
        });
        this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', runEvaluation);
        this.scheduleNodeReflection(userId, executionId, taskId, 'completed', runNodeReflection);
        this.notificationService.sendStepNotificationEmail(task, 'completed', playbookName, {
          output,
          playbookId,
          executionId,
        });
        return { outcome: 'completed' };
      } else if (response.status === 'skipped') {
        const usage = response.result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        const skippedToolTrace = this.mapGrpcToolTrace(response.result?.tool_trace || []);
        const skippedLlmPromptTrace = this.mapGrpcLlmPromptTrace(
          response.result?.llm_prompt_trace || [],
        );
        const semanticMatch = this.mapGrpcSemanticMatch(response.result?.semantic_match);
        await this.updateTaskResult(executionId, taskId, {
          status: StepStatus.SKIPPED,
          output: '',
          toolTrace: skippedToolTrace,
          llmPromptTrace: skippedLlmPromptTrace,
          semanticMatch,
          durationMs,
          completedAt: new Date(),
          isStale: false,
          staleReason: null,
          invalidatedByTaskId: null,
          ...usageFields,
        });

        if (usage) {
          await this.executionModel.findByIdAndUpdate(executionId, {
            $inc: {
              totalInputTokens: usage.input_tokens || 0,
              totalOutputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
            },
          });
          this.usageService
            .recordUsage({
              userId,
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              usageType: UsageType.PLAYBOOK,
              modelName: usage.model || undefined,
              endpoint: 'playbook.executeStep',
              durationMs,
            })
            .catch((err) =>
              this.logger.warn('Failed to record usage', { error: (err as Error).message }),
            );
        }

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'skipped',
            output: '',
            toolTrace: skippedToolTrace,
            llmPromptTrace: skippedLlmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('SSE playbook_step_complete sent', {
          executionId,
          taskId,
          status: 'skipped',
        });
        return { outcome: 'skipped' };
      } else if (response.status === 'suspended') {
        // Store humanFeedback component for single-step interrupt
        const interrupt = response.interrupt;
        this.logger.debug('Step suspended', {
          executionId,
          taskId,
          interruptType: interrupt?.type,
          threadId: response.thread_id,
          durationMs,
        });
        if (interrupt) {
          await this.appendHumanFeedbackComponent(executionId, taskId, {
            interruptType: interrupt.type || 'unknown',
            message: interrupt.message || '',
            status: 'pending',
            taskDescription: interrupt.task_description || '',
            result: interrupt.result || '',
            interruptId: interrupt.interrupt_id || '',
            round: interrupt.round || 0,
            payloadJson: interrupt.conversation_json || '',
            resumableActions: interrupt.resumable_actions || [],
          });
        }
        await this.updateTaskResult(executionId, taskId, {
          status: StepStatus.RUNNING,
          durationMs,
          isStale: false,
          staleReason: null,
          invalidatedByTaskId: null,
        });
        this.notificationService.sendStepNotificationEmail(task, 'interrupted', playbookName, {
          output: interrupt?.message || 'Awaiting human input',
          playbookId,
          executionId,
        });
        return { outcome: 'interrupted', response };
      } else {
        const error = response.result?.error || response.error || 'Step failed';
        this.logger.warn('Step failed (gRPC returned failure)', {
          executionId,
          taskId,
          error,
          durationMs,
        });

        const usage = response.result?.usage;
        const usageFields = usage
          ? {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              modelName: usage.model || null,
            }
          : {};

        const failedToolTrace = this.mapGrpcToolTrace(response.result?.tool_trace || []);
        const failedLlmPromptTrace = this.mapGrpcLlmPromptTrace(
          response.result?.llm_prompt_trace || [],
        );
        const semanticMatch = this.mapGrpcSemanticMatch(response.result?.semantic_match);
        await this.updateTaskResult(executionId, taskId, {
          status: StepStatus.FAILED,
          error,
          toolTrace: failedToolTrace,
          llmPromptTrace: failedLlmPromptTrace,
          semanticMatch,
          durationMs,
          completedAt: new Date(),
          isStale: false,
          staleReason: null,
          invalidatedByTaskId: null,
          ...usageFields,
        });

        if (usage) {
          await this.executionModel.findByIdAndUpdate(executionId, {
            $inc: {
              totalInputTokens: usage.input_tokens || 0,
              totalOutputTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
            },
          });
          this.usageService
            .recordUsage({
              userId,
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              usageType: UsageType.PLAYBOOK,
              modelName: usage.model || undefined,
              endpoint: 'playbook.executeStep',
              durationMs,
            })
            .catch((err) =>
              this.logger.warn('Failed to record usage', { error: (err as Error).message }),
            );
        }

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: {
            executionId,
            taskId,
            status: 'failed',
            error,
            toolTrace: failedToolTrace,
            llmPromptTrace: failedLlmPromptTrace,
            semanticMatch,
            durationMs,
            ...usageFields,
          },
        });
        this.logger.debug('SSE playbook_step_complete sent', {
          executionId,
          taskId,
          status: 'failed',
        });
        this.notificationService.sendStepNotificationEmail(task, 'failed', playbookName, {
          error,
          playbookId,
          executionId,
        });
        return { outcome: 'failed', error };
      }
    } catch (err) {
      const durationMs = Date.now() - stepStartTime;
      const error = (err as Error).message;

      this.logger.error('RunStep gRPC call failed', {
        executionId,
        taskId,
        error,
        stack: (err as Error).stack,
        durationMs,
      });

      await this.updateTaskResult(executionId, taskId, {
        status: StepStatus.FAILED,
        error,
        durationMs,
        completedAt: new Date(),
        isStale: false,
        staleReason: null,
        invalidatedByTaskId: null,
      });

      this.streamGateway.sendToUser(userId, {
        type: 'playbook_step_complete',
        data: { executionId, taskId, status: 'failed', error, durationMs },
      });
      this.logger.debug('SSE playbook_step_complete sent (error)', {
        executionId,
        taskId,
        status: 'failed',
      });
      this.notificationService.sendStepNotificationEmail(task, 'failed', playbookName, {
        error,
        playbookId,
        executionId,
      });
      return { outcome: 'failed', error };
    }
  }

  private async executeStepWithStreaming(
    userId: string,
    executionId: string,
    playbookId: string,
    task: any,
    grpcRequest: any,
    taskOutputs: Map<string, string>,
    playbookName: string,
    runEvaluation: boolean,
    runNodeReflection: boolean,
  ): Promise<{
    outcome: 'completed' | 'failed' | 'interrupted' | 'skipped';
    error?: string;
    response?: any;
  }> {
    const taskId = task.id;
    const startedAt = new Date();
    const sharedBuffer =
      this.bufferService.activeStepBuffers.get(executionId) || new Map<string, BufferedStepResult>();
    this.bufferService.activeStepBuffers.set(executionId, sharedBuffer);

    const taskMap = new Map<string, any>();
    taskMap.set(taskId, task);

    this.logger.debug('RunStepStream gRPC request built', {
      executionId,
      taskId,
      playbookId,
      edgeCount: Array.isArray(grpcRequest?.edges) ? grpcRequest.edges.length : 0,
      triggerEdgeCount: Array.isArray(grpcRequest?.edges)
        ? grpcRequest.edges.filter((edge: any) => (edge.source_id || edge.sourceId) === '__trigger__')
            .length
        : 0,
      upstreamResultCount: Array.isArray(grpcRequest?.upstream_results)
        ? grpcRequest.upstream_results.length
        : 0,
      upstreamArtifactCount: Array.isArray(grpcRequest?.upstream_results)
        ? grpcRequest.upstream_results.reduce(
            (sum: number, item: any) => sum + ((item?.artifacts || []).length || 0),
            0,
          )
        : 0,
      triggerContextPresent: !!grpcRequest?.trigger_context,
    });
    this.logger.debug('RunStepStream gRPC request body', {
      executionId,
      taskId,
      request: JSON.stringify(grpcRequest),
    });

    const call = this.grpcService.runStepStream(grpcRequest);
    let interruptPayload: any = null;
    let threadId = '';

    return new Promise((resolve, reject) => {
      call.on('data', (chunk: any) => {
        if (chunk.thread_id) {
          threadId = chunk.thread_id;
        }
        if (!chunk.step_update) {
          return;
        }

        const normalizedUpdate = this.normalizeStreamStepUpdate(chunk.step_update);
        try {
          this.handleStepUpdate(
            userId,
            executionId,
            normalizedUpdate,
            sharedBuffer,
            taskMap,
            playbookName,
            runEvaluation,
            runNodeReflection,
            playbookId,
          );
        } catch (err) {
          this.logger.error('handleStepUpdate threw during step stream', {
            executionId,
            taskId: normalizedUpdate.task_id,
            error: (err as Error).message,
            stack: (err as Error).stack,
          });
          call.cancel();
          reject(err);
          return;
        }
        if (normalizedUpdate.status === 'suspended' && normalizedUpdate.interrupt) {
          interruptPayload = normalizedUpdate.interrupt;
        }
      });

      call.on('end', async () => {
        try {
          const buffered = sharedBuffer.get(taskId);
          if (buffered) {
            const execution = await this.executionModel
              .findById(executionId)
              .select('taskResults.taskId taskResults.components')
              .lean()
              .exec();
            const existingHumanFeedback = (
              (execution?.taskResults || []).find((tr: any) => tr.taskId === taskId)?.components ||
              []
            ).filter((component: any) => component.type === 'humanFeedback');
            await this.bufferService.flushBufferedTaskResult(
              executionId,
              taskId,
              buffered,
              existingHumanFeedback,
            );
            await this.bufferService.recordBufferedTaskUsage(userId, executionId, buffered, startedAt);

            if (buffered.output) {
              taskOutputs.set(taskId, buffered.output);
              if (task.outputKey) {
                taskOutputs.set(task.outputKey, buffered.output);
              }
            }
          }

          sharedBuffer.delete(taskId);
          if (sharedBuffer.size === 0) {
            this.bufferService.activeStepBuffers.delete(executionId);
          }

          if (interruptPayload) {
            await this.appendHumanFeedbackComponent(executionId, taskId, {
              interruptType: interruptPayload.type || 'unknown',
              message: interruptPayload.message || '',
              status: 'pending',
              taskDescription: interruptPayload.task_description || '',
              result: interruptPayload.result || '',
              interruptId: interruptPayload.interrupt_id || '',
              round: interruptPayload.round || 0,
              payloadJson: interruptPayload.conversation_json || '',
              resumableActions: interruptPayload.resumable_actions || [],
            });
            await this.updateTaskResult(executionId, taskId, {
              status: StepStatus.RUNNING,
              durationMs: buffered?.durationMs ?? Date.now() - startedAt.getTime(),
              isStale: false,
              staleReason: null,
              invalidatedByTaskId: null,
            });
            this.notificationService.sendStepNotificationEmail(task, 'interrupted', playbookName, {
              output: interruptPayload.message || 'Awaiting human input',
              playbookId,
              executionId,
            });
            resolve({
              outcome: 'interrupted',
              response: {
                status: 'suspended',
                interrupt: interruptPayload,
                thread_id: threadId || interruptPayload.thread_id || '',
              },
            });
            return;
          }

          if (!buffered) {
            resolve({ outcome: 'failed', error: 'RunStepStream ended without a step result' });
            return;
          }

          if (buffered.status === StepStatus.COMPLETED) {
            resolve({ outcome: 'completed' });
            return;
          }
          if (buffered.status === StepStatus.SKIPPED) {
            resolve({ outcome: 'skipped' });
            return;
          }
          if (buffered.status === StepStatus.FAILED) {
            resolve({ outcome: 'failed', error: buffered.error || 'Step failed' });
            return;
          }

          resolve({
            outcome: 'failed',
            error: 'RunStepStream ended before the step reached a terminal state',
          });
        } catch (error) {
          reject(error);
        }
      });

      call.on('error', (err: Error) => {
        void (async () => {
          try {
            const buffered = sharedBuffer.get(taskId);
            if (buffered) {
              const execution = await this.executionModel
                .findById(executionId)
                .select('taskResults.taskId taskResults.components')
                .lean()
                .exec();
              const existingHumanFeedback = (
                (execution?.taskResults || []).find((tr: any) => tr.taskId === taskId)
                  ?.components || []
              ).filter((component: any) => component.type === 'humanFeedback');
              await this.bufferService.flushBufferedTaskResult(
                executionId,
                taskId,
                buffered,
                existingHumanFeedback,
              );
            }
          } finally {
            sharedBuffer.delete(taskId);
            if (sharedBuffer.size === 0) {
              this.bufferService.activeStepBuffers.delete(executionId);
            }
          }
          reject(err);
        })().catch((handlerErr: unknown) => {
          this.logger.error('RunStepStream error handler failed', {
            executionId,
            taskId,
            error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
          });
          sharedBuffer.delete(taskId);
          if (sharedBuffer.size === 0) {
            this.bufferService.activeStepBuffers.delete(executionId);
          }
          reject(handlerErr instanceof Error ? handlerErr : err);
        });
      });
    });
  }

  /**
   * Atomic update for a single taskResult element using arrayFilters.
   */
  private async updateTaskResult(
    executionId: string,
    taskId: string,
    fields: Record<string, any>,
  ): Promise<void> {
    // Guard component array size
    if (fields.components && fields.components.length > this.maxComponentsPerTask) {
      this.logger.warn('Truncating components', {
        taskId,
        count: fields.components.length,
        max: this.maxComponentsPerTask,
      });
      fields.components = fields.components.slice(-this.maxComponentsPerTask);
    }

    const $set: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      $set[`taskResults.$[elem].${key}`] = value;
    }

    await this.executionModel.findByIdAndUpdate(
      executionId,
      { $set },
      { arrayFilters: [{ 'elem.taskId': taskId }] },
    );

    await this.syncStepExecutionHistoryEntry(executionId, taskId);
  }

  private mergeTaskArtifacts(
    primary: TaskArtifactEntry[],
    secondary: TaskArtifactEntry[],
  ): TaskArtifactEntry[] {
    const merged = new Map<string, TaskArtifactEntry>();

    for (const artifact of [...(primary || []), ...(secondary || [])]) {
      if (!artifact || typeof artifact !== 'object') {
        continue;
      }

      const key = JSON.stringify({
        portId: artifact.portId,
        artifactKind: artifact.artifactKind,
        content: artifact.content,
        data: artifact.data,
        url: artifact.url,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        sourceTaskId: artifact.sourceTaskId,
        sourcePortId: artifact.sourcePortId,
        producedAt: artifact.producedAt,
        targetInputPortId: artifact.metadata?.target_input_port_id,
      });

      const existing = merged.get(key);
      merged.set(key, {
        ...(existing || {}),
        ...artifact,
        metadata: {
          ...(existing?.metadata || {}),
          ...(artifact.metadata || {}),
        },
      });
    }

    return Array.from(merged.values());
  }

  private groupArtifactsByPort(
    artifacts: Array<{ portId: string; [key: string]: any }>,
  ): Record<string, Array<{ portId: string; [key: string]: any }>> {
    const byPort: Record<string, Array<any>> = {};
    for (const artifact of artifacts || []) {
      const key = artifact.portId || 'default';
      (byPort[key] ??= []).push(artifact);
    }
    return byPort;
  }

  private isTerminalStepStatus(status: string | undefined | null): boolean {
    return (
      status === StepStatus.COMPLETED ||
      status === StepStatus.FAILED ||
      status === StepStatus.SKIPPED
    );
  }

  private async syncStepExecutionHistoryEntry(executionId: string, taskId: string): Promise<void> {
    const execution = await this.executionModel
      .findById(executionId)
      .select({ taskResults: { $elemMatch: { taskId } } })
      .lean()
      .exec();

    const taskResult = execution?.taskResults?.[0] as any;
    if (!taskResult || !this.isTerminalStepStatus(taskResult.status)) {
      return;
    }

    const existingEntries = taskResult.stepExecutions || [];
    const existingEntry = existingEntries.find(
      (entry: any) => entry.attemptNumber === (taskResult.attemptNumber ?? null),
    );
    const nextEntry = {
      id: existingEntry?.id || new Types.ObjectId().toString(),
      attemptNumber: taskResult.attemptNumber ?? null,
      status: taskResult.status,
      output: taskResult.output ?? null,
      error: taskResult.error ?? null,
      durationMs: taskResult.durationMs ?? null,
      startedAt: taskResult.startedAt ?? null,
      completedAt: taskResult.completedAt ?? null,
      components: taskResult.components || [],
      toolTrace: taskResult.toolTrace || [],
      llmPromptTrace: taskResult.llmPromptTrace || [],
      inputTokens: taskResult.inputTokens ?? null,
      outputTokens: taskResult.outputTokens ?? null,
      totalTokens: taskResult.totalTokens ?? null,
      modelName: taskResult.modelName ?? null,
      artifacts: taskResult.artifacts || [],
    };

    const stepExecutions = [
      nextEntry,
      ...existingEntries.filter(
        (entry: any) => entry.attemptNumber !== (taskResult.attemptNumber ?? null),
      ),
    ].sort((a: any, b: any) => {
      const left = new Date(a.completedAt || a.startedAt || 0).getTime();
      const right = new Date(b.completedAt || b.startedAt || 0).getTime();
      return right - left;
    });

    await this.executionModel
      .updateOne(
        { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
        { $set: { 'taskResults.$.stepExecutions': stepExecutions } },
      )
      .exec();
  }

  /**
   * Mark all remaining PENDING tasks as SKIPPED and fail the execution.
   */
  private async markRemainingSkippedAndFail(
    userId: string,
    executionId: string,
    error: string,
    startedAt: Date,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt.getTime();

    this.logger.warn('Marking execution FAILED', { executionId, error, durationMs });

    // Fetch pending taskIds BEFORE bulk-updating
    const currentExecution = await this.executionModel
      .findById(executionId)
      .select('taskResults')
      .lean()
      .exec();
    const skippedTaskIds: string[] = (currentExecution?.taskResults || [])
      .filter((tr: any) => tr.status === StepStatus.PENDING)
      .map((tr: any) => tr.taskId);
    const failedTaskIds: string[] = (currentExecution?.taskResults || [])
      .filter((tr: any) => tr.status === StepStatus.RUNNING)
      .map((tr: any) => tr.taskId);

    const transitioned = await this.trySetExecutionTerminalState(
      executionId,
      ExecutionStatus.FAILED,
      {
        error,
        durationMs,
        completedAt: new Date(),
        interruptPayload: null,
        waitingForHumanInput: false,
        currentInterruptId: null,
        currentInterruptTaskId: null,
      },
    );
    if (!transitioned) {
      this.logger.debug('Skipping FAILED terminal transition because execution is already terminal', {
        executionId,
      });
      return;
    }

    // Terminalize any still-running task and skip the remaining pending tasks.
    await this.executionModel.updateOne(
      { _id: executionId },
      { $set: { 'taskResults.$[elem].status': StepStatus.FAILED } },
      { arrayFilters: [{ 'elem.status': StepStatus.RUNNING }] },
    );

    const skipResult = await this.executionModel.updateOne(
      { _id: executionId },
      { $set: { 'taskResults.$[elem].status': StepStatus.SKIPPED } },
      { arrayFilters: [{ 'elem.status': StepStatus.PENDING }] },
    );

    this.logger.debug('Remaining pending tasks skipped', {
      executionId,
      modifiedCount: skipResult.modifiedCount,
      skippedTaskIds,
      failedTaskIds,
    });

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_complete',
      data: {
        executionId,
        status: ExecutionStatus.FAILED,
        error,
        durationMs,
        skippedTaskIds,
        failedTaskIds,
      },
    });
    this.logger.debug('SSE playbook_execution_complete sent (FAILED)', { executionId, userId });
    this.notificationService.notifyScheduledRunFinished(userId, executionId, 'failed', error);
  }

  /**
   * Mark execution as completed atomically and send SSE.
   */
  private async markExecutionCompleted(
    userId: string,
    executionId: string,
    startedAt: Date,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt.getTime();

    this.logger.debug('Marking execution COMPLETED', { executionId, durationMs });

    const transitioned = await this.trySetExecutionTerminalState(
      executionId,
      ExecutionStatus.COMPLETED,
      {
        durationMs,
        completedAt: new Date(),
        interruptPayload: null,
        waitingForHumanInput: false,
        currentInterruptId: null,
        currentInterruptTaskId: null,
      },
    );
    if (!transitioned) {
      this.logger.debug(
        'Skipping COMPLETED terminal transition because execution is already terminal',
        { executionId },
      );
      return;
    }

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_complete',
      data: { executionId, status: ExecutionStatus.COMPLETED, durationMs },
    });
    this.logger.debug('SSE playbook_execution_complete sent (COMPLETED)', {
      executionId,
      userId,
      durationMs,
    });

    const completedExecution = await this.executionModel
      .findById(executionId)
      .select('reflectionEnabled')
      .lean()
      .exec();
    if (completedExecution?.reflectionEnabled !== false) {
      this.judgeEnrichmentService.scheduleExecutionSweep(userId, executionId);
    }

    this.notificationService.notifyScheduledRunFinished(userId, executionId, 'completed');
  }

  /**
   * Mark execution as cancelled: skip RUNNING and PENDING steps, set status CANCELLED.
   */
  private async markExecutionCancelled(
    userId: string,
    executionId: string,
    startedAt: Date,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt.getTime();

    this.logger.debug('Marking execution CANCELLED', { executionId, durationMs });

    // Fetch taskIds that need to be skipped
    const currentExecution = await this.executionModel
      .findById(executionId)
      .select('taskResults')
      .lean()
      .exec();
    const skippedTaskIds: string[] = (currentExecution?.taskResults || [])
      .filter((tr: any) => tr.status === StepStatus.PENDING || tr.status === StepStatus.RUNNING)
      .map((tr: any) => tr.taskId);

    const transitioned = await this.trySetExecutionTerminalState(
      executionId,
      ExecutionStatus.CANCELLED,
      {
        error: 'Execution cancelled by user',
        durationMs,
        completedAt: new Date(),
        interruptPayload: null,
        waitingForHumanInput: false,
        currentInterruptId: null,
        currentInterruptTaskId: null,
      },
    );
    if (!transitioned) {
      this.logger.debug(
        'Skipping CANCELLED terminal transition because execution is already terminal',
        { executionId },
      );
      return;
    }

    // Bulk skip RUNNING and PENDING taskResults
    await this.executionModel.updateOne(
      { _id: executionId },
      { $set: { 'taskResults.$[elem].status': StepStatus.SKIPPED } },
      { arrayFilters: [{ 'elem.status': { $in: [StepStatus.PENDING, StepStatus.RUNNING] } }] },
    );

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_complete',
      data: { executionId, status: ExecutionStatus.CANCELLED, durationMs, skippedTaskIds },
    });
    this.logger.debug('SSE playbook_execution_complete sent (CANCELLED)', { executionId, userId });
  }

  async rerunStepInExecution(
    userId: string,
    playbookId: string,
    executionId: string,
    taskId: string,
    runEvaluation: boolean = false,
    executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive',
    streamingEnabled: boolean = false,
    runNodeReflection: boolean = true,
    userEmail: string = '',
    advisorAutopilotEnabled: boolean = false,
    advisorAutopilotTargetScore?: number,
    advisorAutopilotMaxTurns?: number,
    skipStepExecution: boolean = false,
  ): Promise<{ status: string; executionId: string }> {
    if (!this.grpcService.isAvailable) {
      this.logger.warn('gRPC unavailable, rejecting rerunStepInExecution', {
        userId,
        playbookId,
        executionId,
      });
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_GRPC_UNAVAILABLE);
    }

    const execution = await this.getExecutionForReuse(userId, playbookId, executionId);

    const playbook = await this.playbookService.findRawById(playbookId);
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const currentPlaybookTask = playbook.tasks.find((candidate: any) => candidate.id === taskId);
    if (!currentPlaybookTask) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Selected step does not exist in this playbook',
      );
    }
    if (currentPlaybookTask.enabled === false) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Disabled steps cannot be executed');
    }

    if (skipStepExecution) {
      const existingTaskResult = (execution.taskResults || []).find(
        (tr: any) => tr.taskId === taskId,
      );

      if (existingTaskResult && existingTaskResult.status === 'completed') {
        this.logger.debug('Skipping step execution, running evaluation only', {
          executionId,
          taskId,
        });

        const effectiveReflectionEnabled =
          runNodeReflection ?? (playbook as any).reflectionEnabled !== false;

        const stepAdvisorEnabled =
          effectiveReflectionEnabled && !currentPlaybookTask.disableAdvisorEvaluation;

        await this.executionModel.findByIdAndUpdate(executionId, {
          $set: {
            runEvaluation: false,
            reflectionEnabled: stepAdvisorEnabled,
            advisorAutopilotStatus: stepAdvisorEnabled ? 'evaluating' : 'idle',
            advisorAutopilotTaskId: taskId,
          },
        }).exec();

        if (stepAdvisorEnabled) {
          await this.executionModel.findByIdAndUpdate(
            executionId,
            {
              $set: {
                'taskResults.$[elem].judgeStatus': 'evaluating',
                'taskResults.$[elem].judgeError': null,
              },
            },
            { arrayFilters: [{ 'elem.taskId': taskId }] },
          ).exec();

          try {
            await this.judgeEnrichmentService.evaluateNodeNow(userId, executionId, taskId);
            await this.judgeEnrichmentService.evaluateExecutionSummaryNowIfReady(userId, executionId);
          } catch (error) {
            this.logger.warn('Skip-step advisor evaluation failed', {
              executionId,
              taskId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            await this.executionModel.findByIdAndUpdate(
              executionId,
              {
                $set: {
                  'taskResults.$[elem].judgeStatus': 'failed',
                  'taskResults.$[elem].judgeError': error instanceof Error ? error.message : 'Unknown error',
                  advisorAutopilotStatus: 'failed',
                  advisorAutopilotLastError: error instanceof Error ? error.message : 'Unknown error',
                },
              },
              { arrayFilters: [{ 'elem.taskId': taskId }] },
            ).exec();
            throw error;
          }

          await this.executionModel.findByIdAndUpdate(executionId, {
            $set: {
              advisorAutopilotStatus: 'evaluated',
            },
          }).exec();
        }

        return { status: 'evaluation_started', executionId };
      }

      this.logger.debug('skipStepExecution requested but step not completed, falling back to full rerun', {
        executionId,
        taskId,
        status: existingTaskResult?.status,
      });
    }

    let snapshot = this.graphService.refreshSnapshotTask(execution.playbookSnapshot as any, playbook, taskId);
    let taskMap = this.graphService.buildTaskMapFromSnapshot(snapshot);
    let task = taskMap.get(taskId);
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: { playbookSnapshot: snapshot },
    });

    const descendants = this.graphService.findDescendantTaskIds(snapshot, taskId);
    const attemptNumber = (execution.currentAttemptNumber ?? 1) + 1;

    const workspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);
    const effectiveReflectionEnabled =
      runNodeReflection ?? (playbook as any).reflectionEnabled !== false;
    const playbookSessionId = `playbook:${playbookId}:execution:${execution.executionNumber}:attempt:${attemptNumber}`;
    const grpcAgentMap = await this.resolveGrpcAgentsForTasks(
      userId,
      snapshot?.tasks || [],
      playbookSessionId,
    );
    await this.ensureTaskResultExists(executionId, task, snapshot, grpcAgentMap, attemptNumber);

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        runEvaluation,
        reflectionEnabled: effectiveReflectionEnabled,
      },
    });

    const selectedExecutionMode = executionMode || (task as any).stepReplayMode || 'live';
    const isReplayMode = selectedExecutionMode === 'replay_strict'
      || selectedExecutionMode === 'replay_flex'
      || selectedExecutionMode === 'replay_adaptive';

    await this.prepareExecutionForRerun(executionId, taskId, attemptNumber);
    await this.resetTaskForAttempt(executionId, taskId, attemptNumber);
    if (!isReplayMode) {
      await this.resetTasksForRecompute(executionId, descendants, taskId, attemptNumber);
    }
    await this.appendAttemptHistory(executionId, attemptNumber, 'rerun_step', taskId, null);

    const startedAt = new Date();
    const validatedReplay =
      selectedExecutionMode !== 'live'
        ? await this.replayService.getActiveReplay(playbookId, taskId)
        : null;
    const advisorAutopilot = this.advisorService.normalizeAdvisorAutopilotConfig(
      advisorAutopilotEnabled,
      advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns,
    );

    await this.executionModel
      .findByIdAndUpdate(executionId, {
        $set: {
          advisorAutopilotEnabled: advisorAutopilot.enabled,
          advisorAutopilotTargetScore: advisorAutopilot.targetScore,
          advisorAutopilotMaxTurns: advisorAutopilot.maxTurns,
          advisorAutopilotStatus: advisorAutopilot.enabled ? 'running' : 'idle',
          advisorAutopilotTaskId: taskId,
          advisorAutopilotAttemptCount: 0,
          advisorAutopilotLastError: null,
        },
      })
      .exec();

    // Merge current playbook task inputFiles into the snapshot task for rerun
    const taskForExecution = { ...task };
    if (currentPlaybookTask?.inputFiles && currentPlaybookTask.inputFiles.length > 0) {
      taskForExecution.inputFiles = currentPlaybookTask.inputFiles;
      this.logger.debug('Using current playbook task inputFiles for rerun', {
        executionId,
        taskId,
        inputFilesCount: currentPlaybookTask.inputFiles.length,
      });
    }

    if (advisorAutopilot.enabled && !currentPlaybookTask.disableAdvisorEvaluation) {
      this.runSingleStepAdvisorAutopilot(
        userId,
        executionId,
        playbook,
        taskForExecution,
        grpcAgentMap,
        workspaceContexts,
        userEmail,
        selectedExecutionMode,
        validatedReplay,
        streamingEnabled,
        advisorAutopilot,
      ).catch(async (err) => {
        this.logger.error('rerunStepInExecution Advisor Autopilot failed', {
          executionId,
          taskId,
          error: (err as Error).message,
        });
        await this.advisorService.updateAdvisorAutopilotState(userId, executionId, {
          status: 'failed',
          taskId,
          attemptCount: 0,
          lastError: (err as Error).message,
        });
        await this.markRemainingSkippedAndFail(
          userId,
          executionId,
          (err as Error).message,
          startedAt,
        );
      });

      return { status: 'rerun_started', executionId };
    }

    this.runSingleStepExecution(
      userId,
      executionId,
      playbook,
      taskForExecution,
      grpcAgentMap,
      workspaceContexts,
      userEmail,
      selectedExecutionMode,
      validatedReplay,
      streamingEnabled,
      runEvaluation,
      effectiveReflectionEnabled,
    ).catch(async (err) => {
      this.logger.error('rerunStepInExecution failed', {
        executionId,
        taskId,
        error: (err as Error).message,
      });
      await this.markRemainingSkippedAndFail(
        userId,
        executionId,
        (err as Error).message,
        startedAt,
      );
    });

    return { status: 'rerun_started', executionId };
  }

  async resumeFromStep(
    userId: string,
    playbookId: string,
    executionId: string,
    taskId: string,
    streamingEnabled: boolean = false,
    userEmail: string = '',
  ): Promise<{ status: string; executionId: string }> {
    const execution = await this.getExecutionForReuse(userId, playbookId, executionId);
    const snapshot = execution.playbookSnapshot as any;
    const taskMap = this.graphService.buildTaskMapFromSnapshot(snapshot);
    const task = taskMap.get(taskId);
    if (!task) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Selected step does not exist in this execution',
      );
    }

    const descendants = this.graphService.findDescendantTaskIds(snapshot, taskId);
    const subgraphIds = [taskId, ...descendants];
    const subgraphIdSet = new Set(subgraphIds);
    const ancestors = this.graphService.findAncestorTaskIds(snapshot, taskId);
    const attemptNumber = (execution.currentAttemptNumber ?? 1) + 1;

    await this.prepareExecutionForRerun(executionId, taskId, attemptNumber);
    await this.resetTaskForAttempt(executionId, taskId, attemptNumber);
    await this.resetTasksForRecompute(executionId, descendants, taskId, attemptNumber);
    await this.appendAttemptHistory(executionId, attemptNumber, 'resume_from_step', taskId, null);

    const playbook = await this.playbookService.findRawById(playbookId);
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const workspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);
    const playbookSessionId = `playbook:${playbookId}:execution:${execution.executionNumber}:attempt:${attemptNumber}`;
    const grpcAgentMap = await this.resolveGrpcAgentsForTasks(
      userId,
      snapshot?.tasks || [],
      playbookSessionId,
    );
    const taskOutputs = this.graphService.seedTaskOutputsFromExecution(execution, snapshot, ancestors);

    const subgraphTasks = (snapshot?.tasks || []).filter(
      (t: any) => subgraphIdSet.has(t.id) && t.enabled !== false,
    );
    const subgraphEdges = (snapshot?.edges || []).filter((edge: any) => {
      const sourceId = this.graphService.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.graphService.normalizeEdgeId(edge.targetId ?? edge.target_id);
      return subgraphIdSet.has(sourceId) && subgraphIdSet.has(targetId);
    });
    const orderedLevels = topologicalSortByLevel(subgraphTasks, subgraphEdges);

    this.runExecutionLoop(
      userId,
      executionId,
      orderedLevels,
      grpcAgentMap,
      { query: '', singleStepTaskId: undefined },
      new Map(subgraphTasks.map((t: any) => [t.id, (t as any).stepReplayMode || 'live'])),
      streamingEnabled,
      workspaceContexts,
      userEmail,
      playbook.name,
      new Map(),
      taskOutputs,
    ).catch((err) => {
      this.logger.error('resumeFromStep failed', {
        executionId,
        taskId,
        error: (err as Error).message,
      });
    });

    return { status: 'resume_from_step_started', executionId };
  }

  /**
   * Stop a running or interrupted execution.
   */
  async stopExecution(
    userId: string,
    playbookId: string,
    executionId: string,
    userEmail: string = '',
  ): Promise<{ status: string }> {
    this.logger.debug('stopExecution called', { userId, playbookId, executionId });

    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if (execution.executedBy?.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    // Idempotent: already terminal
    const terminalStatuses = [
      ExecutionStatus.COMPLETED,
      ExecutionStatus.FAILED,
      ExecutionStatus.CANCELLED,
    ];
    if (terminalStatuses.includes(execution.status as ExecutionStatus)) {
      this.logger.debug('stopExecution: already terminal', { executionId, status: execution.status });
      return { status: execution.status };
    }

    const startedAt = execution.startedAt || new Date();

    if (execution.status === ExecutionStatus.INTERRUPTED) {
      // No active stream Ã¢â‚¬â€ cancel directly
      this.logger.debug('stopExecution: interrupted, cancelling directly', { executionId });
      await this.markExecutionCancelled(userId, executionId, startedAt);
      return { status: ExecutionStatus.CANCELLED };
    }

    // RUNNING: try gRPC stop (best-effort), then cancel stream
    try {
      await this.grpcService.stopPlaybookWorkflow({
        user_context: { user_id: userId, username: userEmail },
        thread_id: execution.threadId || '',
      });
    } catch (err) {
      this.logger.warn('StopPlaybookWorkflow gRPC failed (best-effort)', {
        executionId,
        error: (err as Error).message,
      });
    }

    const activeCall = this.grpcService.getStream(executionId);
    if (activeCall) {
      this.grpcService.markCancelled(executionId);
      activeCall.cancel();
      this.logger.debug('stopExecution: cancelled active stream', { executionId });
    } else {
      // No active stream (race condition) Ã¢â‚¬â€ cancel directly
      this.logger.debug('stopExecution: no active stream, cancelling directly', { executionId });
      await this.markExecutionCancelled(userId, executionId, startedAt);
    }

    return { status: ExecutionStatus.CANCELLED };
  }

  async skipStep(
    userId: string,
    playbookId: string,
    executionId: string,
    taskId: string,
    userEmail: string = '',
  ): Promise<{ status: string }> {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if (execution.executedBy?.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    if (execution.status !== ExecutionStatus.INTERRUPTED) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_EXECUTION_NOT_INTERRUPTED);
    }

    const interruptTaskId = execution.currentInterruptTaskId || execution.interruptPayload?.taskId || '';
    if (!interruptTaskId || interruptTaskId !== taskId) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Only the currently interrupted step can be skipped',
      );
    }

    return this.resumeExecution(
      userId,
      playbookId,
      {
        executionId,
        taskId,
        approved: false,
        reason: SKIP_STEP_REASON,
      },
      userEmail,
    );
  }

  async resumeExecution(
    userId: string,
    playbookId: string,
    dto: ResumePlaybookDto,
    userEmail: string = '',
  ): Promise<{ status: string }> {
    const action = this.normalizeResumeAction(dto);
    const message = this.normalizeResumeMessage(dto);
    this.logger.debug('resumeExecution called', {
      userId,
      playbookId,
      executionId: dto.executionId,
      taskId: dto.taskId,
      action,
    });

    const execution = await this.executionModel.findById(dto.executionId).exec();
    if (!execution) {
      this.logger.warn('resumeExecution: execution not found', { executionId: dto.executionId });
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if (execution.executedBy?.toString() !== userId) {
      this.logger.warn('resumeExecution: user does not own execution', {
        executionId: dto.executionId,
        executedBy: execution.executedBy?.toString(),
        userId,
      });
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    if (execution.status !== ExecutionStatus.INTERRUPTED) {
      this.logger.warn('resumeExecution: execution not interrupted', {
        executionId: dto.executionId,
        currentStatus: execution.status,
      });
      throw new BadRequestException(ErrorCode.PLAYBOOK_EXECUTION_NOT_INTERRUPTED);
    }

    if (!execution.threadId) {
      this.logger.warn('resumeExecution: no thread ID', { executionId: dto.executionId });
      throw new BadRequestException(ErrorCode.PLAYBOOK_EXECUTION_NO_THREAD);
    }

    const executionId = execution._id.toString();
    const startedAt = execution.startedAt!;
    const isSingleStep = !!execution.singleStepTaskId;
    const evalEnabled = (execution as any).runEvaluation === true;
    const reflectionEnabled = (execution as any).reflectionEnabled !== false;
    const activeInterruptPayload = execution.interruptPayload as any;
    const activeInterruptTaskId =
      execution.currentInterruptTaskId || activeInterruptPayload?.taskId || (activeInterruptPayload ? dto.taskId : '');
    const activeInterruptId = execution.currentInterruptId || activeInterruptPayload?.interruptId || '';

    if (!activeInterruptTaskId) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_EXECUTION_NOT_INTERRUPTED,
        'Execution has no active interrupt to resume',
      );
    }

    if (activeInterruptTaskId !== dto.taskId) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'Only the currently interrupted step can be resumed',
      );
    }

    if (dto.interruptId && activeInterruptId && dto.interruptId !== activeInterruptId) {
      throw new BadRequestException(
        ErrorCode.BAD_REQUEST,
        'The interrupt is no longer active. Refresh the execution and try again.',
      );
    }

    const interruptId = dto.interruptId || activeInterruptId;

    // Build structured HumanResponse for gRPC
    const grpcRequest = {
      user_context: { user_id: userId, username: userEmail },
      playbook_id: playbookId,
      thread_id: execution.threadId,
      interrupt_id: interruptId,
      human_response: {
        action,
        message,
        approved: dto.approved ?? action === 'approve',
        reason: dto.reason || '',
        feedback: dto.feedback || '',
      },
      task_id: dto.taskId,
    };

    this.logger.debug('Resume mode determined', {
      executionId,
      isSingleStep,
      threadId: execution.threadId,
    });

    const attemptNumber = (execution.currentAttemptNumber ?? 1) + 1;
    await this.appendAttemptHistory(
      executionId,
      attemptNumber,
      'resume_interrupt',
      dto.taskId,
      execution.threadId || null,
    );

    if (isSingleStep) {
      // ResumeStep is still unary Ã¢â‚¬â€ process synchronously
      const rpcName = 'ResumeStep';
      this.logger.debug(`${rpcName} gRPC request built`, {
        executionId,
        taskId: dto.taskId,
        playbookId,
        threadId: execution.threadId,
      });

      try {
        const resumeStartTime = Date.now();
        const response = await this.grpcService.resumeStep(grpcRequest);
        const resumeDurationMs = Date.now() - resumeStartTime;

        await this.updateHumanFeedbackResponse(executionId, dto.taskId, {
          action,
          message,
          approved: dto.approved,
          reason: dto.reason,
          feedback: dto.feedback,
        }, interruptId, userId);
        this.logger.debug('Human feedback response updated in DB', { executionId, taskId: dto.taskId });
        await this.clearPendingInterruptState(executionId, attemptNumber);

        this.logger.debug(`${rpcName} gRPC response received`, {
          executionId,
          responseStatus: response.status,
          resumeDurationMs,
        });

        // Re-read execution to get current components (including humanFeedback)
        const freshExecution = await this.executionModel.findById(executionId).lean().exec();
        const rawTaskResults = response.result ? [response.result] : [];

        for (const result of rawTaskResults) {
          const taskId = result.task_id;
          const grpcComps = result.components || [];
          const newComponents = mapGrpcComponents(grpcComps, taskId);
          const toolTrace = this.mapGrpcToolTrace(result.tool_trace || []);
          const llmPromptTrace = this.mapGrpcLlmPromptTrace(result.llm_prompt_trace || []);
          const semanticMatch = this.mapGrpcSemanticMatch(result.semantic_match);
          const output = extractTextFromComponents(grpcComps);
          const durationMs = parseInt(result.duration_ms || '0', 10);

          const existingTr = freshExecution?.taskResults.find((tr: any) => tr.taskId === taskId);
          const mergedComponents = mergeWithExistingHumanFeedback(
            (existingTr as any)?.components || [],
            newComponents,
          );

          if (result.status === 'completed') {
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_start',
              data: { executionId, taskId, status: 'running' },
            });
            await this.updateTaskResult(executionId, taskId, {
              status: StepStatus.COMPLETED,
              output,
              components: mergedComponents,
              semanticMatch,
              toolTrace,
              llmPromptTrace,
              durationMs,
              startedAt: new Date(),
              completedAt: new Date(),
            });
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_complete',
              data: {
                executionId,
                taskId,
                status: 'completed',
                output,
                components: mergedComponents,
                toolTrace,
                llmPromptTrace,
                semanticMatch,
                durationMs,
              },
            });
            this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', evalEnabled);
            this.scheduleNodeReflection(
              userId,
              executionId,
              taskId,
              'completed',
              reflectionEnabled,
            );
          } else if (result.status === 'skipped') {
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_start',
              data: { executionId, taskId, status: 'running' },
            });
            await this.updateTaskResult(executionId, taskId, {
              status: StepStatus.SKIPPED,
              output: '',
              toolTrace,
              llmPromptTrace,
              semanticMatch,
              durationMs,
              startedAt: new Date(),
              completedAt: new Date(),
            });
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_complete',
              data: {
                executionId,
                taskId,
                status: 'skipped',
                output: '',
                toolTrace,
                llmPromptTrace,
                semanticMatch,
                durationMs,
              },
            });
          } else if (result.status === 'failed') {
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_start',
              data: { executionId, taskId, status: 'running' },
            });
            const error = result.error || 'Step failed';
            await this.updateTaskResult(executionId, taskId, {
              status: StepStatus.FAILED,
              error,
              components: mergedComponents,
              semanticMatch,
              toolTrace,
              llmPromptTrace,
              durationMs,
              startedAt: new Date(),
              completedAt: new Date(),
            });
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_complete',
              data: {
                executionId,
                taskId,
                status: 'failed',
                error,
                toolTrace,
                llmPromptTrace,
                semanticMatch,
                durationMs,
              },
            });
          }
        }

        if (response.status === 'completed' || response.status === 'skipped') {
          await this.markExecutionCompleted(userId, executionId, startedAt);
        } else if (response.status === 'suspended') {
          const interrupt = response.interrupt;
          const unaryTaskMap = new Map<string, any>();
          const snap = execution.playbookSnapshot as any;
          if (snap?.tasks) {
            for (const t of snap.tasks) unaryTaskMap.set(t.id, t);
          }
          await this.handleStreamInterrupts(
            userId,
            executionId,
            [
              {
                interrupt,
                threadId: response.thread_id || execution.threadId!,
              },
            ],
            unaryTaskMap,
            '',
            playbookId,
          );
        } else {
          this.logger.error(`${rpcName} failed with non-completed, non-interrupted status`, {
            executionId,
            status: response.status,
            error: response.result?.error || response.error || 'Unknown error',
            response: JSON.stringify(response),
          });
          await this.markRemainingSkippedAndFail(
            userId,
            executionId,
            response.error || 'Resume failed',
            startedAt,
          );
        }
        return { status: 'resumed' };
      } catch (error) {
        this.logger.error(`${rpcName} gRPC call failed`, {
          executionId,
          taskId: dto.taskId,
          error: (error as Error).message,
        });
        throw error;
      }
    }

    // Full workflow: fire-and-forget stream
    this.logger.debug('ResumePlaybookWorkflow stream request built', {
      executionId,
      taskId: dto.taskId,
      playbookId,
      threadId: execution.threadId,
    });

    // Immediately notify frontend that the resumed step is running
    const resumedTaskId = dto.taskId;
    this.streamGateway.sendToUser(userId, {
      type: 'playbook_step_start',
      data: { executionId, taskId: resumedTaskId, status: 'running' },
    });

    // Build task map from snapshot for email notifications (no DB call needed)
    const resumeTaskMap = new Map<string, any>();
    const resumeSnapshot = execution.playbookSnapshot as any;
    if (resumeSnapshot?.tasks) {
      for (const t of resumeSnapshot.tasks) resumeTaskMap.set(t.id, t);
    }

    const resumedInterruptPayload = execution.interruptPayload as any;
    const resumedInterruptIdentity = resumedInterruptPayload
      ? {
          interruptId: String(resumedInterruptPayload.interruptId || ''),
          type: String(resumedInterruptPayload.type || ''),
          round: Number(resumedInterruptPayload.round || 0),
        }
      : undefined;

    const call = this.grpcService.resumePlaybookWorkflow({
      ...grpcRequest,
      tasks: resumeSnapshot?.tasks || [],
      edges: resumeSnapshot?.edges || [],
    });
    await this.updateHumanFeedbackResponse(executionId, dto.taskId, {
      action,
      message,
      approved: dto.approved,
      reason: dto.reason,
      feedback: dto.feedback,
    }, interruptId, userId);
    this.logger.debug('Human feedback response updated in DB', { executionId, taskId: dto.taskId });
    await this.clearPendingInterruptState(executionId, attemptNumber);
    this.consumePlaybookStream(
      userId,
      executionId,
      call,
      startedAt,
      resumedTaskId,
      resumedInterruptIdentity,
      resumeTaskMap,
      '',
      playbookId,
    ).catch((err) => {
      this.logger.error('Resume stream failed', { executionId, error: (err as Error).message });
    });

    return { status: 'resumed' };
  }

  /**
   * Find all active (running or interrupted) executions for a given user.
   * Merges in-memory step buffers so catch-up reads (F5, new tab) are fresh
   * without requiring extra DB writes during streaming.
   */
  async findActiveExecutionsByUser(userId: string): Promise<any[]> {
    const executions = await this.executionModel
      .find({
        executedBy: new Types.ObjectId(userId),
        status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
      })
      .lean()
      .exec();

    return executions.map((e: any) => {
      const executionId = (e._id || e.id).toString();
      const buffer = this.bufferService.activeStepBuffers.get(executionId);

      return {
        id: executionId,
        playbookId: e.playbookId.toString(),
        executedBy: e.executedBy.toString(),
        executionNumber: e.executionNumber,
        currentAttemptNumber: e.currentAttemptNumber ?? 1,
        status: e.status,
        executionMode: e.executionMode || 'live',
        reflectionEnabled: e.reflectionEnabled !== false,
        advisorAutopilotEnabled: e.advisorAutopilotEnabled === true,
        advisorAutopilotTargetScore: e.advisorAutopilotTargetScore ?? 90,
        advisorAutopilotMaxTurns: e.advisorAutopilotMaxTurns ?? 2,
        advisorAutopilotStatus: e.advisorAutopilotStatus || 'idle',
        advisorAutopilotTaskId: e.advisorAutopilotTaskId ?? null,
        advisorAutopilotAttemptCount: e.advisorAutopilotAttemptCount ?? 0,
        advisorAutopilotLastError: e.advisorAutopilotLastError ?? null,
        judgeSummaryStatus: e.judgeSummaryStatus || 'idle',
        judgeSummary: e.judgeSummary || null,
        replaySourceByTask: e.replaySourceByTask || null,
        attemptHistory: e.attemptHistory || [],
        taskResults: (e.taskResults || []).map((tr: any) => {
          const merged = buffer?.has(tr.taskId)
            ? this.bufferService.mergeTaskResultWithBuffer(tr, buffer.get(tr.taskId)!)
            : tr;
          return {
            taskId: merged.taskId,
            nodeTitle: merged.nodeTitle,
            agentName: merged.agentName || '',
            order: merged.order,
            status: merged.status,
            output: merged.output,
            error: merged.error,
            durationMs: merged.durationMs,
            startedAt: merged.startedAt?.toISOString?.() || merged.startedAt,
            completedAt: merged.completedAt?.toISOString?.() || merged.completedAt,
            components: merged.components || [],
            artifacts: merged.artifacts || [],
            toolTrace: merged.toolTrace || [],
            llmPromptTrace: merged.llmPromptTrace || [],
            inputTokens: merged.inputTokens ?? null,
            outputTokens: merged.outputTokens ?? null,
            totalTokens: merged.totalTokens ?? null,
            modelName: merged.modelName ?? null,
            semanticMatch: merged.semanticMatch ?? null,
            judgeStatus: merged.judgeStatus || 'idle',
            judgeResult: merged.judgeResult ?? null,
            judgeError: merged.judgeError ?? null,
            advisorTurnCount: merged.advisorTurnCount ?? 0,
            advisorTurnHistory: (merged.advisorTurnHistory || []).map((entry: any) => ({
              turn: entry.turn,
              createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
              score: entry.score ?? null,
              recommendation: entry.recommendation ?? null,
              safeAutoFixType: entry.safeAutoFixType ?? null,
              actionType: entry.actionType,
              stopReason: entry.stopReason ?? null,
            })),
            advisorOptimizationHistory: (merged.advisorOptimizationHistory || []).map(
              (entry: any) => ({
                turn: entry.turn,
                createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
                changedFields: entry.changedFields || [],
                beforeTask: entry.beforeTask || {},
                afterTask: entry.afterTask || {},
              }),
            ),
            lastAdvisorAction: merged.lastAdvisorAction ?? null,
            lastAdvisorScoreDelta: merged.lastAdvisorScoreDelta ?? null,
            advisorStopReason: merged.advisorStopReason ?? null,
            judgeHistory: (merged.judgeHistory || []).map((entry: any) => ({
              ...entry,
              createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
            })),
            evaluationHistory: (merged.evaluationHistory || []).map((entry: any) => ({
              ...entry,
              createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
            })),
            stepExecutions: (merged.stepExecutions || []).map((entry: any) => ({
              ...entry,
              startedAt: entry.startedAt?.toISOString?.() || entry.startedAt || null,
              completedAt: entry.completedAt?.toISOString?.() || entry.completedAt || null,
            })),
            iteratorIterations: (merged.iteratorIterations || []).map((iteration: any) => ({
              index: iteration.index ?? 0,
              status: iteration.status || '',
              itemPreview: iteration.itemPreview ?? '',
              output: iteration.output ?? '',
              error: iteration.error ?? '',
              childResults: (iteration.childResults || []).map((child: any) => ({
                taskId: child.taskId || '',
                taskTitle: child.taskTitle || '',
                status: child.status || '',
                output: child.output ?? '',
                error: child.error ?? '',
                components: child.components || [],
                toolTrace: child.toolTrace || [],
                llmPromptTrace: child.llmPromptTrace || [],
                artifacts: child.artifacts || [],
              })),
              artifacts: iteration.artifacts || [],
            })),
            attemptNumber: merged.attemptNumber ?? 1,
            isStale: merged.isStale ?? false,
            staleReason: merged.staleReason ?? null,
            invalidatedByTaskId: merged.invalidatedByTaskId ?? null,
          };
        }),
        threadId: e.threadId,
        interruptPayload: e.interruptPayload,
        waitingForHumanInput: e.waitingForHumanInput === true,
        currentInterruptId: e.currentInterruptId ?? null,
        currentInterruptTaskId: e.currentInterruptTaskId ?? null,
        hitlHistory: (e.hitlHistory || []).map((entry: any) => ({
          ...entry,
          respondedAt: entry.respondedAt?.toISOString?.() || entry.respondedAt || null,
          createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
        })),
        error: e.error,
        durationMs: e.durationMs,
        startedAt: e.startedAt?.toISOString?.() || e.startedAt,
        completedAt: e.completedAt?.toISOString?.() || e.completedAt,
        singleStepTaskId: e.singleStepTaskId,
        playbookSnapshot: e.playbookSnapshot,
        totalInputTokens: e.totalInputTokens ?? 0,
        totalOutputTokens: e.totalOutputTokens ?? 0,
        totalTokens: e.totalTokens ?? 0,
        createdAt: e.createdAt?.toISOString?.() || e.createdAt,
        updatedAt: e.updatedAt?.toISOString?.() || e.updatedAt,
      };
    });
  }

  /**
   * Append a humanFeedback component to a task's components array in DB.
   */
  private async appendHumanFeedbackComponent(
    executionId: string,
    taskId: string,
    data: {
      interruptType: string;
      message: string;
      status: string;
      taskDescription?: string;
      result?: string;
      interruptId?: string;
      round?: number;
      payloadJson?: string;
      resumableActions?: string[];
    },
  ): Promise<void> {
    const component = {
      id: `hf-${taskId}-${Date.now()}`,
      type: 'humanFeedback',
      data,
    };

    this.logger.debug('Appending humanFeedback component', {
      executionId,
      taskId,
      componentId: component.id,
      interruptType: data.interruptType,
    });

    await this.executionModel.updateOne(
      { _id: executionId, 'taskResults.taskId': taskId },
      {
        $push: {
          'taskResults.$.components': { $each: [component], $slice: -this.maxComponentsPerTask },
        },
      },
    );
  }

  /**
   * Update the latest pending humanFeedback component with the user's structured response.
   */
  private async updateHumanFeedbackResponse(
    executionId: string,
    taskId: string,
    response: {
      action: string;
      message?: string;
      approved?: boolean;
      reason?: string;
      feedback?: string;
    },
    interruptId?: string,
    respondedBy?: string,
  ): Promise<void> {
    this.logger.debug('Updating humanFeedback response', {
      executionId,
      taskId,
      action: response.action,
    });

    const execution = await this.executionModel.findById(executionId).exec();
    if (!execution) {
      this.logger.warn('updateHumanFeedbackResponse: execution not found', { executionId });
      return;
    }

    const taskResult = execution.taskResults.find((tr) => tr.taskId === taskId);
    if (!taskResult) {
      this.logger.warn('updateHumanFeedbackResponse: task result not found', {
        executionId,
        taskId,
      });
      return;
    }

    const components = taskResult.components || [];
    const normalizedInterruptId = interruptId?.trim() || '';
    // Find the last pending humanFeedback component
    for (let i = components.length - 1; i >= 0; i--) {
      const comp = components[i] as any;
      if (
        comp.type === 'humanFeedback'
        && comp.data?.status === 'pending'
        && (!normalizedInterruptId || (comp.data?.interruptId || '') === normalizedInterruptId)
      ) {
        comp.data.status = 'answered';
        comp.data.action = response.action;
        comp.data.replyMessage = response.message || '';
        comp.data.approved = response.approved;
        comp.data.reason = response.reason || '';
        comp.data.feedback = response.feedback || '';
        comp.data.humanResponse =
          response.action === 'approve'
            ? 'approved'
            : response.action === 'reject'
              ? 'rejected'
              : response.action === 'reply'
                ? 'replied'
                : response.action;
        break;
      }
    }

    const hitlHistory = Array.isArray((execution as any).hitlHistory)
      ? [...((execution as any).hitlHistory as any[])]
      : [];
    for (let i = hitlHistory.length - 1; i >= 0; i--) {
      const entry = hitlHistory[i];
      if (entry?.status !== 'pending') {
        continue;
      }
      if (entry?.taskId !== taskId) {
        continue;
      }
      if (normalizedInterruptId && (entry?.interruptId || '') !== normalizedInterruptId) {
        continue;
      }

      entry.status = 'answered';
      entry.responseAction = response.action;
      entry.responseMessage = response.message || '';
      entry.responseApproved = response.approved ?? null;
      entry.responseReason = response.reason || '';
      entry.responseFeedback = response.feedback || '';
      entry.respondedBy = respondedBy || null;
      entry.respondedAt = new Date();
      break;
    }

    taskResult.components = components;
    execution.markModified('taskResults');
    (execution as any).hitlHistory = hitlHistory;
    execution.markModified('hitlHistory');
    await execution.save();
  }
}
