import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  ExecutionStatus,
  StepStatus,
} from '../schemas/playbook-execution.schema';
import { PlaybookService } from './playbook.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookContextService } from './playbook-context.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { ExecutePlaybookDto } from '../dto/execute-playbook.dto';
import { ResumePlaybookDto } from '../dto/resume-playbook.dto';
import { LoggerService } from '../../logger';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '../../exceptions';
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
import {
  extractTextFromComponents,
  mapGrpcComponents,
  pLimit,
  topologicalSortByLevel,
  mergeWithExistingHumanFeedback,
  extractArtifactsFromResult,
  mapGrpcTaskArtifacts,
  MAX_COMPONENTS_PER_TASK_DEFAULT,
  MAX_CONCURRENT_STEPS_DEFAULT,
} from '../utils/execution.utils';
import type { BufferedStepResult } from '../utils/execution.utils';

const SKIP_STEP_REASON = '__SKIP_STEP__';

@Injectable()
export class PlaybookExecutionService {
  private readonly maxComponentsPerTask: number;
  private readonly maxConcurrentSteps: number;
  private readonly frontendBaseUrl: string;
  private readonly activeStepBuffers = new Map<string, Map<string, BufferedStepResult>>();

  constructor(
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
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
  ) {
    this.logger.setContext('PlaybookExecutionService');
    this.maxComponentsPerTask = this.configService.get<number>('playbook.maxComponentsPerTask') || MAX_COMPONENTS_PER_TASK_DEFAULT;
    this.maxConcurrentSteps = this.configService.get<number>('playbook.maxConcurrentSteps') || MAX_CONCURRENT_STEPS_DEFAULT;
    this.frontendBaseUrl = (this.configService.get<string>('app.frontendUrl', 'http://localhost:5173') || '').replace(
      /\/$/,
      '',
    );
  }

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
      return Object.entries(value.fields || {}).reduce<Record<string, unknown>>((acc, [key, fieldValue]) => {
        acc[key] = this.normalizeStructLike(fieldValue);
        return acc;
      }, {});
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
      fields: Object.entries(value || {}).reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
        acc[key] = this.toGrpcStructValue(nestedValue);
        return acc;
      }, {}),
    };
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

    const hasSignal = rawSemanticMatch.match_score !== undefined
      || rawSemanticMatch.semantic_similarity_score !== undefined
      || rawSemanticMatch.reason
      || rawSemanticMatch.judge_used !== undefined;

    if (!hasSignal) {
      return null;
    }

    return {
      matchScore: Number(rawSemanticMatch.match_score ?? 0),
      semanticSimilarityScore: Number(rawSemanticMatch.semantic_similarity_score ?? 0),
      evidenceConsistencyScore: Number(rawSemanticMatch.evidence_consistency_score ?? 0),
      judgeScore: Number(rawSemanticMatch.judge_score ?? 0),
      reason: String(rawSemanticMatch.reason || ''),
      missingPoints: Array.isArray(rawSemanticMatch.missing_points) ? rawSemanticMatch.missing_points.map(String) : [],
      changedPoints: Array.isArray(rawSemanticMatch.changed_points) ? rawSemanticMatch.changed_points.map(String) : [],
      model: String(rawSemanticMatch.model || ''),
      judgeUsed: Boolean(rawSemanticMatch.judge_used),
    };
  }

  private async buildPromptOverrides(): Promise<Record<string, string>> {
    return this.promptService.getPromptOverridesPayload();
  }

  private resolveStreamStepStatus(update: any): string {
    const rawStatus = typeof update?.status === 'string' ? update.status.trim() : '';
    const resultStatus = typeof update?.result?.status === 'string' ? update.result.status.trim() : '';

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
    outputFormat: { generationStatus?: string | null; formatGuide?: string | null } | null | undefined,
  ) {
    const baseDescription = (description || '').trim();
    const guide = (outputFormat?.generationStatus === 'ready' ? outputFormat.formatGuide : '')?.trim();
    if (!guide) {
      return baseDescription;
    }

    const formatInstruction = [
      '## Output format requirements',
      'Follow this output structure and formatting exactly, while using current facts and evidence.',
      '',
      guide,
    ].join('\n');

    return baseDescription
      ? `${baseDescription}\n\n${formatInstruction}`
      : formatInstruction;
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

  private scheduleSemanticEvaluation(userId: string, executionId: string, taskId: string, status: string, runEvaluation: boolean): void {
    if (status !== 'completed' || !runEvaluation) {
      return;
    }
    this.semanticEnrichmentService.schedule(userId, executionId, taskId);
  }

  private isSkipStepReason(reason?: string | null): boolean {
    return reason === SKIP_STEP_REASON;
  }

  private normalizeResumeAction(dto: ResumePlaybookDto): 'reply' | 'approve' | 'reject' | 'skip' {
    if (dto.action === 'reply' || dto.action === 'approve' || dto.action === 'reject' || dto.action === 'skip') {
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

  private normalizeEdgeId(value: any): string {
    return value?.toString?.() || value || '';
  }

  private buildEdgeKey(edge: any): string {
    const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
    const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
    const sourcePortId = this.normalizeEdgeId(edge.sourceOutputPortId ?? edge.source_output_port_id) || 'default';
    const targetPortId = this.normalizeEdgeId(edge.targetInputPortId ?? edge.target_input_port_id) || 'default';
    return `${sourceId}:${sourcePortId}->${targetId}:${targetPortId}`;
  }

  private buildTaskMapFromSnapshot(snapshot: any): Map<string, any> {
    const map = new Map<string, any>();
    for (const task of snapshot?.tasks || []) {
      map.set(task.id, task);
    }
    return map;
  }

  private findAncestorTaskIds(snapshot: any, taskId: string): string[] {
    const ancestors = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const edge of snapshot?.edges || []) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (targetId !== currentId || ancestors.has(sourceId)) {
          continue;
        }
        ancestors.add(sourceId);
        queue.push(sourceId);
      }
    }
    return [...ancestors];
  }

  private findDescendantTaskIds(snapshot: any, taskId: string): string[] {
    const descendants = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const edge of snapshot?.edges || []) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (sourceId !== currentId || descendants.has(targetId)) {
          continue;
        }
        descendants.add(targetId);
        queue.push(targetId);
      }
    }
    descendants.delete(taskId);
    return [...descendants];
  }

  private seedTaskOutputsFromExecution(execution: any, snapshot: any, ancestorTaskIds: string[]): Map<string, string> {
    const taskOutputs = new Map<string, string>();
    const allowed = new Set(ancestorTaskIds);
    const taskMap = this.buildTaskMapFromSnapshot(snapshot);

    for (const tr of execution.taskResults || []) {
      if (!allowed.has(tr.taskId) || tr.status !== StepStatus.COMPLETED || !tr.output || tr.isStale) {
        continue;
      }
      taskOutputs.set(tr.taskId, tr.output);
      const task = taskMap.get(tr.taskId);
      const outputKey = task?.outputKey;
      if (outputKey) {
        taskOutputs.set(outputKey, tr.output);
      }
    }

    return taskOutputs;
  }

  private buildWorkspaceContextFromUpstreamArtifacts(
    execution: any,
    snapshot: any,
    taskId: string,
  ): {
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }>;
    inputFilesByPort: Array<{ port_id: string; document_ids: string[] }>;
  } {
    const docsByWorkspace = new Map<string, Map<string, any>>();
    const docIdsByPort = new Map<string, Set<string>>();
    const taskResultsById = new Map<string, any>();

    for (const tr of execution.taskResults || []) {
      taskResultsById.set(tr.taskId, tr);
    }

    for (const edge of snapshot?.edges || []) {
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      if (targetId !== taskId) continue;

      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const sourcePortId = edge.sourceOutputPortId || edge.source_output_port_id || 'default';
      const targetPortId = edge.targetInputPortId || edge.target_input_port_id || 'default';
      const taskResult = taskResultsById.get(sourceId);
      if (!taskResult || taskResult.status !== StepStatus.COMPLETED || taskResult.isStale) {
        continue;
      }

      const matchingArtifacts = (taskResult.artifacts || []).filter((artifact: any) =>
        artifact?.portId === sourcePortId
        && artifact?.artifactKind === 'document'
        && typeof artifact?.url === 'string'
        && artifact.url.trim()
        && typeof artifact?.filename === 'string'
        && artifact.filename.trim()
        && !artifact.url.startsWith('/box/')
        && !artifact.url.startsWith('sandbox:/box/')
      );

      if (matchingArtifacts.length === 0) continue;
      if (!docIdsByPort.has(targetPortId)) {
        docIdsByPort.set(targetPortId, new Set<string>());
      }

      matchingArtifacts.forEach((artifact: any, index: number) => {
        const syntheticDocId = `artifact:${sourceId}:${sourcePortId}:${index}:${artifact.filename}`;
        const workspaceId = artifact?.metadata?.workspaceId || artifact?.metadata?.workspace_id || 'playbook_artifacts';

        if (!docsByWorkspace.has(workspaceId)) {
          docsByWorkspace.set(workspaceId, new Map<string, any>());
        }

        docsByWorkspace.get(workspaceId)!.set(syntheticDocId, {
          _id: syntheticDocId,
          filename: artifact.filename,
          filepath: artifact.url,
          in_memory: false,
          language: 'fr',
          indexing_token: 1200,
          workspace_id: workspaceId,
          createdAt: null,
        });
        docIdsByPort.get(targetPortId)!.add(syntheticDocId);
      });
    }

    return {
      workspaceContexts: Array.from(docsByWorkspace.entries()).map(([workspace_id, docMap]) => ({
        workspace_id,
        workspace_documents: Array.from(docMap.values()),
      })),
      inputFilesByPort: Array.from(docIdsByPort.entries()).map(([port_id, ids]) => ({
        port_id,
        document_ids: Array.from(ids),
      })),
    };
  }

  private mergeWorkspaceContexts(
    baseContexts: Array<{ workspace_id: string; workspace_documents: any[] }>,
    extraContexts: Array<{ workspace_id: string; workspace_documents: any[] }>,
  ): Array<{ workspace_id: string; workspace_documents: any[] }> {
    const merged = new Map<string, Map<string, any>>();

    for (const ctx of [...(baseContexts || []), ...(extraContexts || [])]) {
      const workspaceId = ctx.workspace_id;
      if (!workspaceId) continue;
      if (!merged.has(workspaceId)) {
        merged.set(workspaceId, new Map<string, any>());
      }
      const docs = merged.get(workspaceId)!;
      for (const doc of ctx.workspace_documents || []) {
        const docId = doc?._id || doc?.id;
        if (!docId) continue;
        docs.set(String(docId), doc);
      }
    }

    return Array.from(merged.entries()).map(([workspace_id, docs]) => ({
      workspace_id,
      workspace_documents: Array.from(docs.values()),
    }));
  }

  private buildRunStepRoutingState(execution: any, snapshot: any, taskId: string): {
    edges: any[];
    upstreamResults: any[];
  } {
    const incomingEdges = (snapshot?.edges || []).filter((edge: any) =>
      this.normalizeEdgeId(edge.targetId ?? edge.target_id) === taskId,
    );

    const sourceIds = new Set(
      incomingEdges.map((edge: any) => this.normalizeEdgeId(edge.sourceId ?? edge.source_id)).filter(Boolean),
    );

    const upstreamResults = (execution?.taskResults || [])
      .filter((tr: any) => sourceIds.has(tr.taskId) && !tr.isStale)
      .map((tr: any) => ({
        task_id: tr.taskId,
        status: tr.status,
        error: tr.error || '',
        duration_ms: tr.durationMs || 0,
        artifacts: (tr.artifacts || []).map((artifact: any) => ({
          port_id: artifact.portId || 'default',
          artifact_kind: artifact.artifactKind || 'text',
          content: artifact.content || '',
          url: artifact.url || '',
          filename: artifact.filename || '',
          mime_type: artifact.mimeType || '',
          size: artifact.size || 0,
        })),
      }));

    return {
      edges: incomingEdges.map((edge: any) => ({
        source_id: this.normalizeEdgeId(edge.sourceId ?? edge.source_id),
        target_id: this.normalizeEdgeId(edge.targetId ?? edge.target_id),
        source_output_port_id: edge.sourceOutputPortId || edge.source_output_port_id || 'default',
        target_input_port_id: edge.targetInputPortId || edge.target_input_port_id || 'default',
      })),
      upstreamResults,
    };
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
        singleStepTaskId: taskId,
        currentAttemptNumber: attemptNumber,
      },
    });
  }

  private mergeSnapshotForNewTask(existingSnapshot: any, playbook: any, taskId: string): any {
    const snapshotTasks = existingSnapshot?.tasks || [];
    const snapshotEdges = existingSnapshot?.edges || [];
    const playbookTasks = playbook?.tasks || [];
    const playbookEdges = playbook?.edges || [];

    const existingTaskIds = new Set<string>(snapshotTasks.map((task: any) => task.id));
    const playbookTaskMap = new Map<string, any>(playbookTasks.map((task: any) => [task.id, task]));
    const additionalTaskIds = new Set<string>();
    const queue = [taskId];

    while (queue.length > 0) {
      const currentTaskId = queue.shift()!;
      if (existingTaskIds.has(currentTaskId) || additionalTaskIds.has(currentTaskId)) {
        continue;
      }

      const currentTask = playbookTaskMap.get(currentTaskId);
      if (!currentTask) {
        continue;
      }

      additionalTaskIds.add(currentTaskId);

      for (const edge of playbookEdges) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (sourceId === currentTaskId && !existingTaskIds.has(targetId) && !additionalTaskIds.has(targetId)) {
          queue.push(targetId);
        }
        if (targetId === currentTaskId && !existingTaskIds.has(sourceId) && !additionalTaskIds.has(sourceId)) {
          queue.push(sourceId);
        }
      }
    }

    const mergedTaskIds = new Set<string>([...existingTaskIds, ...additionalTaskIds]);
    const mergedTasks = [
      ...snapshotTasks,
      ...Array.from(additionalTaskIds)
        .map((id) => playbookTaskMap.get(id))
        .filter(Boolean)
        .map((task: any) => ((task as any).toObject ? (task as any).toObject() : task)),
    ];

    const seenEdges = new Set<string>();
    const mergedEdges = [...snapshotEdges];
    for (const edge of snapshotEdges) {
      seenEdges.add(this.buildEdgeKey(edge));
    }

    for (const edge of playbookEdges) {
      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      if (!mergedTaskIds.has(sourceId) || !mergedTaskIds.has(targetId)) {
        continue;
      }
      const edgeKey = this.buildEdgeKey(edge);
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);
      mergedEdges.push((edge as any).toObject ? (edge as any).toObject() : edge);
    }

    return {
      tasks: mergedTasks,
      edges: mergedEdges,
    };
  }

  private refreshSnapshotTask(existingSnapshot: any, playbook: any, taskId: string): any {
    const snapshot = this.mergeSnapshotForNewTask(existingSnapshot, playbook, taskId);
    const playbookTask = (playbook?.tasks || []).find((task: any) => task.id === taskId);
    if (!playbookTask) {
      return snapshot;
    }

    return {
      ...snapshot,
      tasks: (snapshot?.tasks || []).map((task: any) =>
        task.id === taskId
          ? ((playbookTask as any).toObject ? (playbookTask as any).toObject() : playbookTask)
          : task),
    };
  }

  private async ensureTaskResultExists(
    executionId: string,
    task: any,
    snapshot: any,
    grpcAgentMap: Map<string, IGrpcAgent>,
    attemptNumber: number,
  ): Promise<void> {
    const execution = await this.executionModel.findById(executionId).select('taskResults.taskId').lean().exec();
    const existingTaskIds = new Set<string>((execution?.taskResults || []).map((result: any) => result.taskId));
    if (existingTaskIds.has(task.id)) {
      return;
    }

    const enabledTasks = (snapshot?.tasks || []).filter((candidate: any) => candidate.enabled !== false);
    const enabledTaskIds = new Set(enabledTasks.map((candidate: any) => candidate.id));
    const enabledEdges = (snapshot?.edges || []).filter((edge: any) => {
      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      return enabledTaskIds.has(sourceId) && enabledTaskIds.has(targetId);
    });
    const orderedTasks = topologicalSortByLevel(enabledTasks, enabledEdges).flat();
    const topoOrderMap = new Map<string, number>();
    orderedTasks.forEach((orderedTask: any, index: number) => topoOrderMap.set(orderedTask.id, index));

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
        },
      },
    });
  }

  private async resetTaskForAttempt(executionId: string, taskId: string, attemptNumber: number): Promise<void> {
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
      invalidatedByTaskId: null,
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
    const referencedAgentIds = [...new Set(
      tasks
        .filter((t: any) => t.assignedAgentId)
        .map((t: any) => t.assignedAgentId.toString()),
    )];

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
   * Creates a `PlaybookExecution` and starts the run loop. Use `options.executionTrigger === 'scheduled'`
   * only from trusted internal callers (e.g. schedule runner). User-facing `POST /playbooks/:id/execute` must
   * pass `manual` via the controller.
   */
  async executePlaybook(
    userId: string,
    playbookId: string,
    dto: ExecutePlaybookDto,
    userEmail: string = '',
    options?: { executionTrigger?: 'manual' | 'scheduled' },
  ): Promise<{ executionId: string }> {
    const executionTrigger: 'manual' | 'scheduled' =
      options?.executionTrigger === 'scheduled' ? 'scheduled' : 'manual';
    const mode = dto.singleStepTaskId ? 'single-step' : 'full-workflow';
    const globalExecutionMode = dto.executionMode || 'live';
    this.logger.log('executePlaybook called', {
      userId,
      playbookId,
      mode,
      executionMode: globalExecutionMode,
      singleStepTaskId: dto.singleStepTaskId || null,
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
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook must have a default workspace before execution');
    }

    const enabledTasks = playbook.tasks.filter((task: any) => task.enabled !== false);
    const enabledTaskIds = new Set(enabledTasks.map((task: any) => task.id));
    const enabledEdges = playbook.edges.filter(
      (edge: any) => enabledTaskIds.has(edge.sourceId?.toString?.() || edge.sourceId)
        && enabledTaskIds.has(edge.targetId?.toString?.() || edge.targetId),
    );
    const sanitizedEnabledEdges = this.sanitizeEdgesForTasks(enabledTasks, enabledEdges);

    if (!dto.singleStepTaskId && enabledTasks.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'No enabled steps to execute');
    }

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
    const activeExecution = await this.executionModel.findOne({
      playbookId: new Types.ObjectId(playbookId),
      status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
    }).lean().exec();

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
      const referencedAgentIds = [...new Set(
        playbook.tasks
          .filter((t: any) => t.assignedAgentId)
          .map((t: any) => t.assignedAgentId.toString()),
      )];
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
      status: dto.singleStepTaskId && dto.singleStepTaskId !== task.id
        ? StepStatus.SKIPPED
        : task.enabled === false
        ? StepStatus.SKIPPED
        : StepStatus.PENDING,
      output: null,
      error: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
    }));

    const stepExecutionModes = dto.stepExecutionModes || {};
    const effectiveModes = new Map<string, string>();

    for (const task of enabledTasks) {
      if (dto.singleStepTaskId && task.id !== dto.singleStepTaskId) continue;
      const effectiveMode = globalExecutionMode === 'inherit'
        ? (stepExecutionModes[task.id] ?? (task as any).stepReplayMode ?? 'live')
        : 'live';
      effectiveModes.set(task.id, effectiveMode);
    }

    const replayTaskIds = [...effectiveModes.entries()]
      .filter(([, m]) => m !== 'live')
      .map(([id]) => id);
    const executionTaskIds = [...effectiveModes.keys()];
    const activeReplayMap = await this.replayService.getActiveReplays(playbookId, replayTaskIds);
    const activeOutputFormatMap = await this.outputFormatService.getActiveTemplates(playbookId, executionTaskIds);

    const hasReplaySteps = replayTaskIds.length > 0;

    const execution = await this.executionModel.create({
      playbookId: new Types.ObjectId(playbookId),
      executedBy: new Types.ObjectId(userId),
      executionNumber,
      currentAttemptNumber: 1,
      status: ExecutionStatus.RUNNING,
      executionMode: globalExecutionMode,
      executionTrigger,
      runEvaluation: dto.runEvaluation === true,
      replaySourceByTask: hasReplaySteps
        ? this.buildReplaySourceMap(activeReplayMap)
        : null,
      taskResults,
      threadId: null,
      interruptPayload: null,
      error: null,
      durationMs: null,
      startedAt: new Date(),
      completedAt: null,
      singleStepTaskId: dto.singleStepTaskId || null,
      attemptHistory: [{
        attemptNumber: 1,
        type: 'initial',
        taskId: dto.singleStepTaskId || null,
        threadId: null,
        startedAt: new Date(),
        completedAt: null,
      }],
      playbookSnapshot: {
        tasks: playbook.tasks.map((t) => (t as any).toObject ? (t as any).toObject() : t),
        edges: sanitizedEnabledEdges.map((e) => (e as any).toObject ? (e as any).toObject() : e),
      },
    });

    const executionId = execution._id.toString();

    this.logger.log('Execution record created', {
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
        replaySourceByTask: hasReplaySteps
          ? this.buildReplaySourceMap(activeReplayMap)
          : null,
        taskResults,
      },
    });
    this.logger.log('SSE playbook_execution_start sent', { executionId, userId });

    // Build workspace contexts from playbook-linked workspaces
    const workspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);

    if (dto.singleStepTaskId) {
      // Single-step mode: use RunStep gRPC for just the one task
      this.logger.log('Starting single-step execution loop', { executionId, taskId: dto.singleStepTaskId });
      this.runExecutionLoop(userId, executionId, orderedLevels, grpcAgentMap, dto, effectiveModes, dto.streaming === true, workspaceContexts, userEmail, playbook.name, activeReplayMap).catch(
        async (err) => {
          this.logger.error('Execution loop failed', {
            executionId,
            error: (err as Error).message,
          });
          try {
            const exec = await this.executionModel.findById(executionId).select('startedAt status').lean().exec();
            const startedAt = exec?.startedAt ? new Date(exec.startedAt) : new Date();
            const isTerminal = exec?.status && ['completed', 'failed', 'cancelled'].includes(exec.status as string);
            if (!isTerminal) {
              await this.markRemainingSkippedAndFail(userId, executionId, (err as Error).message, startedAt);
            }
          } catch (finalizeErr) {
            this.logger.error('Failed to finalize execution after loop error', {
              executionId,
              error: (finalizeErr as Error).message,
            });
          }
        },
      );
    } else {
      // Full workflow mode: delegate to LangGraph via RunPlaybookWorkflow
      this.logger.log('Starting full workflow execution', { executionId, playbookId });
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
      ).catch(
        async (err) => {
          this.logger.error('Full workflow failed', {
            executionId,
            error: (err as Error).message,
          });
          try {
            const exec = await this.executionModel.findById(executionId).select('startedAt status').lean().exec();
            const startedAt = exec?.startedAt ? new Date(exec.startedAt) : new Date();
            const isTerminal = exec?.status && ['completed', 'failed', 'cancelled'].includes(exec.status as string);
            if (!isTerminal) {
              await this.markRemainingSkippedAndFail(userId, executionId, (err as Error).message, startedAt);
            }
          } catch (finalizeErr) {
            this.logger.error('Failed to finalize execution after workflow error', {
              executionId,
              error: (finalizeErr as Error).message,
            });
          }
        },
      );
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
  ): Promise<void> {
    this.logger.log('runFullWorkflow start', { executionId, userId });

    const execution = await this.executionModel.findById(executionId)
      .select('taskResults.taskId taskResults.status playbookSnapshot playbookId startedAt')
      .lean()
      .exec();
    if (!execution) {
      this.logger.warn('runFullWorkflow: execution not found', { executionId });
      return;
    }

    const startedAt = execution.startedAt!;
    const playbookId = execution.playbookId.toString();
    const globalExecutionMode = dto.executionMode || 'live';
    const enabledTasks = playbook.tasks.filter((task: any) => task.enabled !== false);
    const enabledTaskIds = new Set(enabledTasks.map((task: any) => task.id));
    const enabledEdges = (playbook.edges || []).filter(
      (edge: any) => enabledTaskIds.has(edge.sourceId || edge.source_id)
        && enabledTaskIds.has(edge.targetId || edge.target_id),
    );
    const sanitizedEnabledEdges = this.sanitizeEdgesForTasks(enabledTasks, enabledEdges);

    // Build RunPlaybookWorkflowRequest
    const stepExecutionModesForGrpc: Record<string, string> = {};
    for (const task of enabledTasks) {
      const em = effectiveModes.get(task.id);
      if (em && em !== 'live') {
        stepExecutionModesForGrpc[task.id] = em;
      }
    }

    // Pre-extract input file IDs for all tasks (port-aware)
    const taskInputFileIdsByPortMap = new Map<string, Array<{ port_id: string; document_ids: string[] }>>();
    const workspaceContextMap = new Map<string, Map<string, any>>();

    const addWorkspaceContexts = (contexts: Array<{ workspace_id: string; workspace_documents: any[] }>) => {
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

        const taskWorkspaceContexts = await this.contextService.buildWorkspaceContextFromInputFiles(task.inputFiles);
        addWorkspaceContexts(taskWorkspaceContexts);
      }
    }

    const effectiveWorkspaceContexts = Array.from(workspaceContextMap.entries()).map(([workspace_id, docMap]) => ({
      workspace_id,
      workspace_documents: Array.from(docMap.values()),
    }));
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
          description: this.applyOutputFormatGuide(t.description || '', activeOutputFormatMap.get(t.id)),
          assigned_agent_id: t.assignedAgentId?.toString() || '',
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
    };

    if (activeReplayMap.size > 0) {
      request.validated_replays = Array.from(activeReplayMap.values()).map((replay) => {
        const outputFormat = activeOutputFormatMap.get(replay.taskId);
        return this.formatReplayForGrpc({
          ...replay,
          preserveOutputFormat: outputFormat?.generationStatus === 'ready' ? true : replay.preserveOutputFormat,
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

    this.logger.log('RunPlaybookWorkflow gRPC request built', {
      executionId,
      playbookId,
      taskCount: request.tasks?.length,
      agentCount: request.agents?.length,
      edgeCount: request.edges?.length,
      query: request.query || null,
      tasksWithInputFiles: request.tasks?.filter((t: any) => t.input_files_by_port?.length > 0).map((t: any) => ({
        taskId: t.id,
        inputFilesByPort: t.input_files_by_port || [],
      })) || [],
    });
    this.logger.debug('RunPlaybookWorkflow gRPC request body', {
      executionId,
      request: JSON.stringify(request),
    });

    // Build task map for email notifications
    const taskMap = new Map<string, any>();
    for (const t of playbook.tasks) taskMap.set(t.id, t);

    const call = this.grpcService.runPlaybookWorkflow(request);
    return this.consumePlaybookStream(userId, executionId, call, startedAt, undefined, undefined, taskMap, playbookName, playbookId);
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
    playbookId: string = '',
  ): void {
    const normalizedUpdate = this.normalizeStreamStepUpdate(update);
    const { task_id: taskId, status, result, interrupt } = normalizedUpdate;

    this.logger.log('Stream step update received', {
      executionId,
      taskId,
      status,
      rawStatus: update?.status || '',
      resultStatus: update?.result?.status || '',
    });

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
        const artifacts = grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(activeTask, grpcComps);

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

        if (result && (grpcComps.length > 0 || toolTrace.length > 0 || llmPromptTrace.length > 0 || artifacts.length > 0)) {
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
        const artifacts = grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(completedTask, grpcComps);

        const usage = result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

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
          ...usageFields,
        });
          this.streamGateway.sendToUser(userId, {
            type: 'playbook_step_complete',
            data: { executionId, taskId, status: 'completed', output, components, artifacts, toolTrace, llmPromptTrace, semanticMatch, durationMs, ...usageFields },
          });
          this.logger.log('SSE playbook_step_complete sent (workflow)', { executionId, taskId, status: 'completed' });
          this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', evalEnabled);
        if (completedTask) this.sendStepNotificationEmail(completedTask, 'completed', playbookName, { output });
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
        const artifacts = grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(failedTask, grpcComps);

        const usage = result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

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
          ...usageFields,
        });
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: { executionId, taskId, status: 'failed', error, artifacts, components, toolTrace, llmPromptTrace, semanticMatch, durationMs, ...usageFields },
        });
        this.logger.log('SSE playbook_step_complete sent (workflow)', { executionId, taskId, status: 'failed', error });
        if (failedTask) this.sendStepNotificationEmail(failedTask, 'failed', playbookName, { error });
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
        const artifacts = grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(skippedTask, grpcComps);

        const usage = result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

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
          ...usageFields,
        });
        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: { executionId, taskId, status: 'skipped', output: '', artifacts, components, toolTrace, llmPromptTrace, semanticMatch, durationMs, ...usageFields },
        });
        this.logger.log('SSE playbook_step_complete sent (workflow)', { executionId, taskId, status: 'skipped' });
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

  private sanitizeEdgesForTasks(tasks: any[], edges: any[]): any[] {
    const taskMap = new Map<string, any>();
    for (const task of tasks || []) {
      taskMap.set(task.id, task);
    }

    return (edges || []).filter((edge: any) => {
      const sourceId = edge.sourceId || edge.source_id;
      const targetId = edge.targetId || edge.target_id;
      const sourceTask = taskMap.get(sourceId);
      const targetTask = taskMap.get(targetId);

      if (!sourceTask || !targetTask) {
        this.logger.warn('Dropping edge with missing task reference', {
          edgeId: edge.id,
          sourceId,
          targetId,
        });
        return false;
      }

      const sourcePortId = edge.sourceOutputPortId || edge.source_output_port_id || 'default';
      const targetPortId = edge.targetInputPortId || edge.target_input_port_id || 'default';
      const sourcePorts = sourceTask.outputPorts || sourceTask.output_ports || [];
      const targetPorts = targetTask.inputPorts || targetTask.input_ports || [];

      const sourcePortExists = sourcePorts.length === 0 || sourcePorts.some((p: any) => p.id === sourcePortId);
      const targetPortExists = targetPorts.length === 0 || targetPorts.some((p: any) => p.id === targetPortId);

      if (!sourcePortExists || !targetPortExists) {
        this.logger.warn('Dropping edge with stale port reference', {
          edgeId: edge.id,
          sourceId,
          sourcePortId,
          targetId,
          targetPortId,
          sourcePortIds: sourcePorts.map((p: any) => p.id),
          targetPortIds: targetPorts.map((p: any) => p.id),
        });
        return false;
      }

      return true;
    });
  }

  /**
   * Flush all buffered step results to MongoDB.
   * Preserves existing humanFeedback components (important during resume).
   */
  private async flushStepBuffer(
    executionId: string,
    stepBuffer: Map<string, BufferedStepResult>,
  ): Promise<void> {
    if (stepBuffer.size === 0) return;

    this.logger.log('Flushing step buffer to DB', {
      executionId,
      stepCount: stepBuffer.size,
    });

    // Read existing humanFeedback components so we can preserve them
    const execution = await this.executionModel.findById(executionId)
      .select('taskResults.taskId taskResults.components').lean().exec();
    const hfMap = new Map<string, any[]>();
    for (const tr of execution?.taskResults || []) {
      const hf = ((tr as any).components || []).filter((c: any) => c.type === 'humanFeedback');
      if (hf.length > 0) hfMap.set((tr as any).taskId, hf);
    }

    for (const [taskId, buffered] of stepBuffer) {
      await this.flushBufferedTaskResult(executionId, taskId, buffered, hfMap.get(taskId) || []);
    }
  }

  private async flushBufferedTaskResult(
    executionId: string,
    taskId: string,
    buffered: BufferedStepResult,
    existingHumanFeedback: any[] = [],
  ): Promise<void> {
    const fields: Record<string, any> = {
      status: buffered.status,
      startedAt: buffered.startedAt,
    };
    if (buffered.output !== undefined) fields.output = buffered.output;
    if (buffered.error !== undefined) fields.error = buffered.error;
    if (buffered.durationMs !== undefined) fields.durationMs = buffered.durationMs;
    if (buffered.completedAt !== undefined) fields.completedAt = buffered.completedAt;
    if (buffered.inputTokens !== undefined) fields.inputTokens = buffered.inputTokens;
    if (buffered.outputTokens !== undefined) fields.outputTokens = buffered.outputTokens;
    if (buffered.totalTokens !== undefined) fields.totalTokens = buffered.totalTokens;
    if (buffered.modelName !== undefined) fields.modelName = buffered.modelName;
    if (buffered.semanticMatch !== undefined) fields.semanticMatch = buffered.semanticMatch;
    if (buffered.toolTrace !== undefined) fields.toolTrace = buffered.toolTrace;
    if ((buffered as any).llmPromptTrace !== undefined) fields.llmPromptTrace = (buffered as any).llmPromptTrace;
    if ((buffered as any).artifacts !== undefined) fields.artifacts = (buffered as any).artifacts;
    if (buffered.components !== undefined) {
      fields.components = mergeWithExistingHumanFeedback(existingHumanFeedback, buffered.components);
    }
    await this.updateTaskResult(executionId, taskId, fields);
  }

  private async recordBufferedTaskUsage(
    userId: string,
    executionId: string,
    buffered: BufferedStepResult,
    startedAt: Date,
  ): Promise<void> {
    const inputTokens = buffered.inputTokens ?? 0;
    const outputTokens = buffered.outputTokens ?? 0;
    const totalTokens = buffered.totalTokens ?? 0;
    if (totalTokens <= 0) {
      return;
    }

    await this.executionModel.findByIdAndUpdate(executionId, {
      $inc: {
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        totalTokens,
      },
    });

    this.usageService.recordUsage({
      userId,
      inputTokens,
      outputTokens,
      usageType: UsageType.PLAYBOOK,
      modelName: buffered.modelName || undefined,
      endpoint: 'playbook.executeStep.stream',
      durationMs: Date.now() - startedAt.getTime(),
    }).catch((err) => this.logger.warn('Failed to record step stream usage', { error: (err as Error).message }));
  }

  /**
   * Handle stream interrupts Ã¢â‚¬â€ multiple steps can suspend per stream.
   * Creates humanFeedback component + sends SSE for each suspended step.
   */
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
        this.sendStepNotificationEmail(interruptTask, 'interrupted', playbookName, {
          output: interrupt?.message || 'Awaiting human input',
          playbookId,
          executionId,
        });
      }
    }

    const firstInterrupt = interrupts[0]?.interrupt;
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.INTERRUPTED,
        threadId: threadId || null,
        interruptPayload: firstInterrupt
          ? {
              type: firstInterrupt.type,
              taskId: firstInterrupt.task_id,
              taskTitle: firstInterrupt.task_title,
              message: firstInterrupt.message,
              threadId: firstInterrupt.thread_id,
              interruptId: firstInterrupt.interrupt_id || '',
              round: firstInterrupt.round || 0,
              payloadJson: firstInterrupt.conversation_json || '',
              resumableActions: firstInterrupt.resumable_actions || [],
              taskDescription: firstInterrupt.task_description || '',
              result: firstInterrupt.result || '',
            }
          : null,
      },
    });
  }

  /**
   * Aggregate usage from step buffer and record to DB + usage service.
   */
  private async recordStreamUsage(
    userId: string,
    executionId: string,
    stepBuffer: Map<string, BufferedStepResult>,
    startedAt: Date,
  ): Promise<void> {
    let aggInput = 0, aggOutput = 0, aggTotal = 0;
    let lastModel: string | undefined;
    for (const buffered of stepBuffer.values()) {
      if (buffered.inputTokens) aggInput += buffered.inputTokens;
      if (buffered.outputTokens) aggOutput += buffered.outputTokens;
      if (buffered.totalTokens) aggTotal += buffered.totalTokens;
      if (buffered.modelName) lastModel = buffered.modelName;
    }
    if (aggTotal > 0) {
      await this.executionModel.findByIdAndUpdate(executionId, {
        $inc: {
          totalInputTokens: aggInput,
          totalOutputTokens: aggOutput,
          totalTokens: aggTotal,
        },
      });
      this.usageService.recordUsage({
        userId,
        inputTokens: aggInput,
        outputTokens: aggOutput,
        usageType: UsageType.PLAYBOOK,
        modelName: lastModel,
        endpoint: 'playbook.workflow',
        durationMs: Date.now() - startedAt.getTime(),
      }).catch((err) => this.logger.warn('Failed to record workflow usage', { error: (err as Error).message }));
    }
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
    this.activeStepBuffers.set(executionId, stepBuffer);
    const suspendedInterrupts: Array<{ interrupt: any; threadId: string }> = [];
    let streamThreadId = '';

    let evalEnabled = false;
    try {
      const execRecord = await this.executionModel.findById(executionId).select('runEvaluation').lean().exec();
      evalEnabled = execRecord?.runEvaluation === true;
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

    return new Promise<void>((resolve, reject) => {
      call.on('data', (chunk: any) => {
        resetIdleTimeout();

        if (chunk.thread_id) streamThreadId = chunk.thread_id;

        if (chunk.step_update) {
          const normalizedUpdate = this.normalizeStreamStepUpdate(chunk.step_update);
          try {
            this.handleStepUpdate(userId, executionId, normalizedUpdate, stepBuffer, taskMap, playbookName, evalEnabled);
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
          if (normalizedUpdate.status === 'suspended' && normalizedUpdate.interrupt) {
            const interruptTaskId = normalizedUpdate.interrupt.task_id || normalizedUpdate.task_id;
            const sameTask = resumedTaskId && interruptTaskId === resumedTaskId;
            const interruptId = normalizedUpdate.interrupt.interrupt_id || '';
            const interruptType = normalizedUpdate.interrupt.type || '';
            const interruptRound = normalizedUpdate.interrupt.round || 0;
            const sameInterrupt =
              !!sameTask
              && (
                (resumedInterruptIdentity?.interruptId && interruptId === resumedInterruptIdentity.interruptId)
                || (
                  !resumedInterruptIdentity?.interruptId
                  && interruptType === (resumedInterruptIdentity?.type || '')
                  && interruptRound === (resumedInterruptIdentity?.round || 0)
                )
              );

            if (sameInterrupt) {
              this.logger.log('Skipping stale re-emitted interrupt for resumed task', {
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
          await this.flushStepBuffer(executionId, stepBuffer);
          this.activeStepBuffers.delete(executionId);
          await this.recordStreamUsage(userId, executionId, stepBuffer, startedAt);

          const wasCancelled = this.grpcService.wasCancelled(executionId);
          if (wasCancelled) {
            await this.markExecutionCancelled(userId, executionId, startedAt);
            resolve();
            return;
          }

          const resumedBuffered = resumedTaskId ? stepBuffer.get(resumedTaskId) : undefined;
          const resumedNeedsCompletion = resumedTaskId && (
            !resumedBuffered ||
            resumedBuffered.status === StepStatus.RUNNING
          );
          if (resumedTaskId && resumedNeedsCompletion) {
            this.logger.log('Resumed task had no stream update, sending completion from DB', {
              executionId, resumedTaskId,
            });
            const freshExec = await this.executionModel.findById(executionId)
              .select('taskResults').lean().exec();
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
            await this.handleStreamInterrupts(userId, executionId, suspendedInterrupts, taskMap, playbookName, playbookId);
          } else {
            const freshExecCheck = await this.executionModel.findById(executionId)
              .select('taskResults').lean().exec();
            const hasPendingOrRunning = (freshExecCheck?.taskResults || []).some(
              (tr: any) => tr.status === StepStatus.PENDING || tr.status === StepStatus.RUNNING,
            );

            if (hasPendingOrRunning) {
              this.logger.warn('Stream ended prematurely with tasks still pending/running', {
                executionId,
              });
              await this.markRemainingSkippedAndFail(
                userId, executionId, 'Stream ended unexpectedly before all tasks completed', startedAt,
              );
            } else {
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
            await this.flushStepBuffer(executionId, stepBuffer);
            this.activeStepBuffers.delete(executionId);
            await this.markExecutionCancelled(userId, executionId, startedAt);
            resolve();
            return;
          }

          this.logger.error('Workflow stream error', {
            executionId,
            error: err.message,
          });
          await this.flushStepBuffer(executionId, stepBuffer);
          this.activeStepBuffers.delete(executionId);
          await this.markRemainingSkippedAndFail(userId, executionId, err.message, startedAt);
          reject(err);
        })().catch(async (handlerErr: unknown) => {
          this.logger.error('Workflow stream error handler failed', {
            executionId,
            error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
          });
          try {
            this.activeStepBuffers.delete(executionId);
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
    this.logger.log('runExecutionLoop start', {
      executionId,
      userId,
      levelCount: orderedLevels.length,
      totalTasks: orderedLevels.reduce((sum, lvl) => sum + lvl.length, 0),
    });

    const execution = await this.executionModel.findById(executionId)
      .select('taskResults.taskId taskResults.status playbookSnapshot playbookId startedAt runEvaluation')
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
        this.logger.log('Skipping empty level', { executionId, levelIndex });
        levelIndex++;
        continue;
      }

      this.logger.log('Executing level', {
        executionId,
        levelIndex,
        taskCount: runnableTasks.length,
        taskIds: runnableTasks.map((t: any) => t.id),
      });

      // Execute all tasks in this level with concurrency limit
      const limiter = pLimit(this.maxConcurrentSteps);
      const results = await Promise.allSettled(
        runnableTasks.map((task) =>
          limiter(() => this.executeStep(userId, executionId, playbookId, task, grpcAgentMap, taskOutputs, snapshot, workspaceContexts, userEmail, playbookName, effectiveModes.get(task.id) || 'live', activeReplayMap.get(task.id) || null, (execution as any).runEvaluation === true, streamingEnabled)),
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

      this.logger.log('Level execution results', {
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
        this.logger.log('Level interrupted', {
          executionId,
          levelIndex,
          taskId: interruptResult.task.id,
          interruptType: interrupt?.type,
          threadId: response.thread_id,
        });

        await this.executionModel.findByIdAndUpdate(executionId, {
          $set: {
            status: ExecutionStatus.INTERRUPTED,
            threadId: response.thread_id || null,
            interruptPayload: interrupt
              ? {
                  type: interrupt.type,
                  taskId: interrupt.task_id,
                  taskTitle: interrupt.task_title,
                  message: interrupt.message,
                  threadId: interrupt.thread_id,
                  payloadJson: interrupt.payload_json,
                }
              : null,
          },
        });

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
        this.logger.log('SSE playbook_interrupt sent (loop)', { executionId, taskId: interruptResult.task.id });
        return;
      }
      levelIndex++;
    }

    // All levels completed
    this.logger.log('All levels completed', { executionId });
    await this.markExecutionCompleted(userId, executionId, startedAt);
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
    streamingEnabled: boolean = false,
  ): Promise<{ outcome: 'completed' | 'failed' | 'interrupted' | 'skipped'; error?: string; response?: any }> {
    const taskId = task.id;

    this.logger.log('executeStep start', {
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
    this.logger.log('SSE playbook_step_start sent', { executionId, taskId });

    // DB: mark running
    await this.updateTaskResult(executionId, taskId, {
      status: StepStatus.RUNNING,
      startedAt: new Date(),
      isStale: false,
      staleReason: null,
      invalidatedByTaskId: null,
    });

    const contextFromDependencies = this.gatherContext(task, taskOutputs, snapshot);

    // Build gRPC request
    const grpcAgent = task.assignedAgentId
      ? grpcAgentMap.get(task.assignedAgentId.toString()) || null
      : null;

    const activeOutputFormat = await this.outputFormatService.getActiveTemplate(playbookId, taskId);

    // If task has inputFiles, build workspace_context from those (overrides playbook-level context)
    let taskWorkspaceContexts = workspaceContexts;
    let inputFilesByPort: Array<{ port_id: string; document_ids: string[] }> = [];
    if (task.inputFiles && task.inputFiles.length > 0) {
      taskWorkspaceContexts = await this.contextService.buildWorkspaceContextFromInputFiles(task.inputFiles);
      inputFilesByPort = await this.contextService.extractDocumentIdsByPort(task.inputFiles);
      this.logger.log('Using task-level input files for workspace_context', {
        executionId,
        taskId,
        inputFilesCount: task.inputFiles.length,
        contextCount: taskWorkspaceContexts.length,
        inputFilesByPortCount: inputFilesByPort.length,
      });
    }

    const currentExecutionState = await this.executionModel.findById(executionId).select('taskResults').lean().exec();

    const upstreamPortInputs = this.buildWorkspaceContextFromUpstreamArtifacts(
      currentExecutionState,
      snapshot,
      taskId,
    );
    const routingState = this.buildRunStepRoutingState(currentExecutionState, snapshot, taskId);
    if (upstreamPortInputs.workspaceContexts.length > 0 || upstreamPortInputs.inputFilesByPort.length > 0) {
      taskWorkspaceContexts = this.mergeWorkspaceContexts(taskWorkspaceContexts, upstreamPortInputs.workspaceContexts);
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
      this.logger.log('Injected upstream port artifacts for step execution', {
        executionId,
        taskId,
        workspaceContextCount: taskWorkspaceContexts.length,
        inputFilesByPortCount: inputFilesByPort.length,
      });
    }

    const promptOverrides = await this.buildPromptOverrides();

    const grpcRequest: any = {
      user_context: { user_id: userId, username: userEmail },
      playbook_id: playbookId,
      task: {
        id: taskId,
        title: task.title,
        description: this.applyOutputFormatGuide(task.description || '', activeOutputFormat),
        assigned_agent_id: task.assignedAgentId?.toString() || '',
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
      },
      context_from_dependencies: contextFromDependencies,
      workspace_context: taskWorkspaceContexts,
      execution_mode: executionMode,
      edges: routingState.edges,
      upstream_results: routingState.upstreamResults,
      prompt_overrides: promptOverrides,
    };

    if (grpcAgent) {
      grpcRequest.agent = grpcAgent;
    }

    if (validatedReplay) {
      grpcRequest.validated_replay = this.formatReplayForGrpc({
        ...validatedReplay,
        preserveOutputFormat: activeOutputFormat?.generationStatus === 'ready' ? true : validatedReplay.preserveOutputFormat,
        outputFormatGuide:
          activeOutputFormat?.generationStatus === 'ready' && activeOutputFormat?.formatGuide
            ? activeOutputFormat.formatGuide
            : validatedReplay.outputFormatGuide,
      });
    }

    this.logger.log('RunStep gRPC request built', {
      executionId,
      taskId,
      playbookId,
      hasAgent: !!grpcAgent,
      agentName: grpcAgent?.name || null,
      contextLength: contextFromDependencies.length,
      edgeCount: routingState.edges.length,
      upstreamResultCount: routingState.upstreamResults.length,
      workspaceContextSource: task.inputFiles && task.inputFiles.length > 0 ? 'task_inputFiles' : 'playbook_workspaces',
      workspaceContextCount: taskWorkspaceContexts.length,
      inputFilesByPort: inputFilesByPort,
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
      );
    }

    const stepStartTime = Date.now();
    try {
      const response = await this.grpcService.runStep(grpcRequest);
      const durationMs = Date.now() - stepStartTime;

      this.logger.log('RunStep gRPC response received', {
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
        const artifacts = grpcArtifacts.length > 0 ? grpcArtifacts : extractArtifactsFromResult(task, grpcComps);

        const usage = response.result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

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
          this.usageService.recordUsage({
            userId,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            usageType: UsageType.PLAYBOOK,
            modelName: usage.model || undefined,
            endpoint: 'playbook.executeStep',
            durationMs,
          }).catch((err) => this.logger.warn('Failed to record usage', { error: (err as Error).message }));
        }

        taskOutputs.set(taskId, output);
        if (task.outputKey) {
          taskOutputs.set(task.outputKey, output);
        }

          this.streamGateway.sendToUser(userId, {
            type: 'playbook_step_complete',
            data: { executionId, taskId, status: 'completed', output, components, artifacts, toolTrace, llmPromptTrace, semanticMatch, durationMs, ...usageFields },
          });
          this.logger.log('Step completed', { executionId, taskId, componentCount: components.length, durationMs });
          this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', runEvaluation);
          this.sendStepNotificationEmail(task, 'completed', playbookName, {
            output,
            playbookId,
            executionId,
          });
        return { outcome: 'completed' };
      } else if (response.status === 'skipped') {
        const usage = response.result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

        const skippedToolTrace = this.mapGrpcToolTrace(response.result?.tool_trace || []);
        const skippedLlmPromptTrace = this.mapGrpcLlmPromptTrace(response.result?.llm_prompt_trace || []);
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
          this.usageService.recordUsage({
            userId,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            usageType: UsageType.PLAYBOOK,
            modelName: usage.model || undefined,
            endpoint: 'playbook.executeStep',
            durationMs,
          }).catch((err) => this.logger.warn('Failed to record usage', { error: (err as Error).message }));
        }

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: { executionId, taskId, status: 'skipped', output: '', toolTrace: skippedToolTrace, llmPromptTrace: skippedLlmPromptTrace, semanticMatch, durationMs, ...usageFields },
        });
        this.logger.log('SSE playbook_step_complete sent', { executionId, taskId, status: 'skipped' });
        return { outcome: 'skipped' };
      } else if (response.status === 'suspended') {
        // Store humanFeedback component for single-step interrupt
        const interrupt = response.interrupt;
        this.logger.log('Step suspended', {
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
        this.sendStepNotificationEmail(task, 'interrupted', playbookName, {
          output: interrupt?.message || 'Awaiting human input',
          playbookId,
          executionId,
        });
        return { outcome: 'interrupted', response };
      } else {
        const error = response.result?.error || response.error || 'Step failed';
        this.logger.warn('Step failed (gRPC returned failure)', { executionId, taskId, error, durationMs });

        const usage = response.result?.usage;
        const usageFields = usage ? {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: usage.model || null,
        } : {};

        const failedToolTrace = this.mapGrpcToolTrace(response.result?.tool_trace || []);
        const failedLlmPromptTrace = this.mapGrpcLlmPromptTrace(response.result?.llm_prompt_trace || []);
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
          this.usageService.recordUsage({
            userId,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            usageType: UsageType.PLAYBOOK,
            modelName: usage.model || undefined,
            endpoint: 'playbook.executeStep',
            durationMs,
          }).catch((err) => this.logger.warn('Failed to record usage', { error: (err as Error).message }));
        }

        this.streamGateway.sendToUser(userId, {
          type: 'playbook_step_complete',
          data: { executionId, taskId, status: 'failed', error, toolTrace: failedToolTrace, llmPromptTrace: failedLlmPromptTrace, semanticMatch, durationMs, ...usageFields },
        });
        this.logger.log('SSE playbook_step_complete sent', { executionId, taskId, status: 'failed' });
        this.sendStepNotificationEmail(task, 'failed', playbookName, {
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
      this.logger.log('SSE playbook_step_complete sent (error)', { executionId, taskId, status: 'failed' });
      this.sendStepNotificationEmail(task, 'failed', playbookName, {
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
  ): Promise<{ outcome: 'completed' | 'failed' | 'interrupted' | 'skipped'; error?: string; response?: any }> {
    const taskId = task.id;
    const startedAt = new Date();
    const sharedBuffer = this.activeStepBuffers.get(executionId) || new Map<string, BufferedStepResult>();
    this.activeStepBuffers.set(executionId, sharedBuffer);

    const taskMap = new Map<string, any>();
    taskMap.set(taskId, task);

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
          this.handleStepUpdate(userId, executionId, normalizedUpdate, sharedBuffer, taskMap, playbookName, runEvaluation, playbookId);
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
          const execution = await this.executionModel.findById(executionId)
            .select('taskResults.taskId taskResults.components')
            .lean()
            .exec();
          const existingHumanFeedback = ((execution?.taskResults || []).find((tr: any) => tr.taskId === taskId)?.components || [])
            .filter((component: any) => component.type === 'humanFeedback');
          await this.flushBufferedTaskResult(executionId, taskId, buffered, existingHumanFeedback);
          await this.recordBufferedTaskUsage(userId, executionId, buffered, startedAt);

            if (buffered.output) {
              taskOutputs.set(taskId, buffered.output);
              if (task.outputKey) {
                taskOutputs.set(task.outputKey, buffered.output);
              }
            }
          }

          sharedBuffer.delete(taskId);
          if (sharedBuffer.size === 0) {
            this.activeStepBuffers.delete(executionId);
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
              durationMs: buffered?.durationMs ?? (Date.now() - startedAt.getTime()),
              isStale: false,
              staleReason: null,
              invalidatedByTaskId: null,
            });
            this.sendStepNotificationEmail(task, 'interrupted', playbookName, {
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

          resolve({ outcome: 'failed', error: 'RunStepStream ended before the step reached a terminal state' });
        } catch (error) {
          reject(error);
        }
      });

      call.on('error', (err: Error) => {
        void (async () => {
          try {
            const buffered = sharedBuffer.get(taskId);
            if (buffered) {
              const execution = await this.executionModel.findById(executionId)
                .select('taskResults.taskId taskResults.components')
                .lean()
                .exec();
              const existingHumanFeedback = ((execution?.taskResults || []).find((tr: any) => tr.taskId === taskId)?.components || [])
                .filter((component: any) => component.type === 'humanFeedback');
              await this.flushBufferedTaskResult(executionId, taskId, buffered, existingHumanFeedback);
            }
          } finally {
            sharedBuffer.delete(taskId);
            if (sharedBuffer.size === 0) {
              this.activeStepBuffers.delete(executionId);
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
            this.activeStepBuffers.delete(executionId);
          }
          reject(handlerErr instanceof Error ? handlerErr : err);
        });
      });
    });
  }

  private buildExecutionDetailUrl(playbookId: string, executionId: string): string {
    return `${this.frontendBaseUrl}/#/playbooks/${playbookId}/executions/${executionId}`;
  }

  /**
   * Short line for emails: run number, per-step status counts, duration (when scheduled run ends).
   * Only standard playbook step statuses contribute to the counts; unrecognized values are omitted.
   */
  private formatExecutionSummaryForEmail(doc: {
    executionNumber?: number;
    taskResults?: Array<{ status?: string }>;
    startedAt?: Date;
    completedAt?: Date | null;
  }): string | null {
    const segments: string[] = [];

    const runNum = doc.executionNumber;
    if (runNum != null && Number.isFinite(Number(runNum))) {
      segments.push(`Run #${runNum}`);
    }

    const tasks = doc.taskResults ?? [];
    if (tasks.length > 0) {
      const byStatus = new Map<string, number>();
      for (const t of tasks) {
        const key = String(t.status ?? '').toLowerCase();
        if (!key) continue;
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
      }

      const stepParts = (
        [
          [StepStatus.COMPLETED, 'completed'],
          [StepStatus.FAILED, 'failed'],
          [StepStatus.SKIPPED, 'skipped'],
          [StepStatus.RUNNING, 'running'],
          [StepStatus.PENDING, 'pending'],
        ] as const
      )
        .map(([status, label]) => {
          const n = byStatus.get(status) ?? 0;
          return n ? `${n} ${label}` : null;
        })
        .filter((s): s is string => s != null);

      if (stepParts.length) {
        segments.push(`Steps: ${stepParts.join(', ')}`);
      }
    }

    if (doc.startedAt && doc.completedAt) {
      const ms = new Date(doc.completedAt).getTime() - new Date(doc.startedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        segments.push(`Duration: ${Math.round(ms / 1000)}s`);
      }
    }

    return segments.length ? segments.join(' · ') : null;
  }

  /**
   * Send email notification when a step finishes (completed, failed, or interrupted).
   * Fire-and-forget Ã¢â‚¬â€ never awaited, never blocks execution. Failures are logged only.
   */
  private sendStepNotificationEmail(
    task: { id: string; title: string; notifyOnComplete?: boolean; notifyEmails?: string[] },
    status: string,
    playbookName: string,
    opts: {
      output?: string;
      error?: string;
      /** When set with executionId, adds an optional link to the execution detail page in the app. */
      playbookId?: string;
      executionId?: string;
      /** Optional one-line summary shown above the link (e.g. scheduled-run summary). */
      executionSummary?: string;
    } = {},
  ): void {
    if (!task.notifyOnComplete || !task.notifyEmails?.length) return;
    if (!this.emailService.isAvailable()) return;

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const statusColor = status === 'completed' ? '#22c55e' : status === 'failed' ? '#ef4444' : '#eab308';
    const safeTitle = esc(task.title);
    const safeName = esc(playbookName);

    const subject = `Playbook step "${task.title}" Ã¢â‚¬â€ ${statusLabel}`;

    const errorRow = opts.error
      ? `<tr><td style="padding:8px 16px;color:#ef4444;" colspan="2"><strong>Error:</strong> ${esc(opts.error)}</td></tr>`
      : '';

    // Truncate output to avoid oversized emails (keep first 5000 chars)
    const rawOutput = opts.output || '';
    const truncated = rawOutput.length > 5000;
    const outputPreview = truncated ? rawOutput.slice(0, 5000) : rawOutput;
    const outputRow = outputPreview
      ? `<tr><td colspan="2" style="padding:12px 16px;">
<div style="font-size:11px;color:#6b7280;margin-bottom:4px;font-weight:600;">Result</div>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${nl2br(outputPreview)}${truncated ? '<br><em style="color:#9ca3af;">Ã¢â‚¬Â¦ truncated</em>' : ''}</div>
</td></tr>`
      : '';

    const detailUrl =
      opts.playbookId && opts.executionId
        ? this.buildExecutionDetailUrl(opts.playbookId, opts.executionId)
        : null;
    const summaryHtml = opts.executionSummary
      ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;"><strong>Execution summary</strong><br/>${esc(opts.executionSummary)}</p>`
      : '';
    const detailLinkHtml = detailUrl
      ? `<p style="margin:0;font-size:13px;"><a href="${esc(detailUrl)}">View execution details</a></p>`
      : '';
    const executionBlock =
      summaryHtml || detailLinkHtml
        ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">${summaryHtml}${detailLinkHtml}</div>`
        : '';

    const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
<h2 style="margin:0 0 16px;">Step Notification</h2>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:8px 16px;color:#6b7280;">Playbook</td><td style="padding:8px 16px;font-weight:600;">${safeName}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Step</td><td style="padding:8px 16px;font-weight:600;">${safeTitle}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Status</td><td style="padding:8px 16px;font-weight:600;color:${statusColor};">${statusLabel}</td></tr>
${errorRow}
${outputRow}
</table>
${executionBlock}
<p style="margin-top:16px;font-size:12px;color:#9ca3af;">Sent by YelloStorm Playbook</p>
</div>`;

    const textOutput = outputPreview ? `\n\nResult:\n${outputPreview}${truncated ? '\nÃ¢â‚¬Â¦ truncated' : ''}` : '';
    const textSummary = opts.executionSummary ? `\n\nExecution summary:\n${opts.executionSummary}` : '';
    const textDetail = detailUrl ? `\n\nExecution details: ${detailUrl}` : '';
    const text = `Step "${task.title}" in playbook "${playbookName}" finished with status: ${statusLabel}${opts.error ? `\nError: ${opts.error}` : ''}${textOutput}${textSummary}${textDetail}`;

    this.emailService.send({ to: task.notifyEmails, subject, html, text }).catch((err) => {
      this.logger.warn('Failed to send step notification email', { taskId: task.id, error: (err as Error).message });
    });
  }

  /**
   * Email the playbook owner when a **scheduled** run reaches a terminal state (success or failure).
   * Fire-and-forget; failures are logged only and never block persistence or SSE.
   */
  private notifyScheduledRunFinished(
    userId: string,
    executionId: string,
    outcome: 'completed' | 'failed',
    error?: string | null,
  ): void {
    void this.notifyScheduledRunFinishedAsync(userId, executionId, outcome, error);
  }

  private async notifyScheduledRunFinishedAsync(
    userId: string,
    executionId: string,
    outcome: 'completed' | 'failed',
    error?: string | null,
  ): Promise<void> {
    try {
      const doc = await this.executionModel
        .findById(executionId)
        .select(
          'executionTrigger playbookId playbookSnapshot executionNumber taskResults.status startedAt completedAt',
        )
        .lean()
        .exec();
      if (!doc || doc.executionTrigger !== 'scheduled') {
        return;
      }
      if (!this.emailService.isAvailable()) {
        return;
      }

      const snapshot = doc.playbookSnapshot as { name?: string } | null | undefined;
      let playbookName = snapshot?.name;
      if (!playbookName && doc.playbookId) {
        const pb = await this.playbookService.findRawById(doc.playbookId.toString());
        playbookName = (pb as { name?: string } | null)?.name;
      }
      playbookName = playbookName || 'Playbook';

      const user = await this.userService.findById(userId);
      const to = user?.email;
      if (!to) {
        return;
      }

      const playbookIdStr = doc.playbookId?.toString() || '';
      const detailUrl = playbookIdStr
        ? this.buildExecutionDetailUrl(playbookIdStr, executionId)
        : '';

      const summaryLine = this.formatExecutionSummaryForEmail({
        executionNumber: doc.executionNumber,
        taskResults: doc.taskResults as Array<{ status?: string }> | undefined,
        startedAt: doc.startedAt as Date | undefined,
        completedAt: doc.completedAt as Date | null | undefined,
      });

      const statusLabel = outcome === 'completed' ? 'Completed' : 'Failed';
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const subject = `[YelloStorm] Scheduled playbook "${playbookName}" — ${statusLabel}`;

      const errorBlock =
        outcome === 'failed' && error
          ? `<tr><td colspan="2" style="padding:8px 16px;color:#ef4444;"><strong>Error:</strong> ${esc(error)}</td></tr>`
          : '';

      const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
<h2 style="margin:0 0 16px;">Scheduled run finished</h2>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:8px 16px;color:#6b7280;">Playbook</td><td style="padding:8px 16px;font-weight:600;">${esc(playbookName)}</td></tr>
<tr><td style="padding:8px 16px;color:#6b7280;">Status</td><td style="padding:8px 16px;font-weight:600;">${esc(statusLabel)}</td></tr>
${errorBlock}
</table>
${
  summaryLine
    ? `<p style="margin-top:14px;font-size:13px;color:#4b5563;line-height:1.5;"><strong>Summary</strong><br/>${esc(
        summaryLine,
      )}</p>`
    : ''
}
${
  detailUrl
    ? `<p style="margin-top:12px;"><a href="${esc(detailUrl)}">View execution details</a></p>`
    : ''
}
<p style="margin-top:16px;font-size:12px;color:#9ca3af;">Sent by YelloStorm Playbook</p>
</div>`;

      const text = `Scheduled playbook "${playbookName}" finished: ${statusLabel}${
        error ? `\nError: ${error}` : ''
      }${summaryLine ? `\n\nSummary: ${summaryLine}` : ''}${detailUrl ? `\n\nDetails: ${detailUrl}` : ''}`;

      await this.emailService.send({ to: [to], subject, html, text });
    } catch (err) {
      this.logger.warn('Failed to send scheduled execution notification email', {
        executionId,
        error: (err as Error).message,
      });
    }
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
      this.logger.warn('Truncating components', { taskId, count: fields.components.length, max: this.maxComponentsPerTask });
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

  private isTerminalStepStatus(status: string | undefined | null): boolean {
    return status === StepStatus.COMPLETED
      || status === StepStatus.FAILED
      || status === StepStatus.SKIPPED;
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
    const existingEntry = existingEntries.find((entry: any) => entry.attemptNumber === (taskResult.attemptNumber ?? null));
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
      ...existingEntries.filter((entry: any) => entry.attemptNumber !== (taskResult.attemptNumber ?? null)),
    ].sort((a: any, b: any) => {
      const left = new Date(a.completedAt || a.startedAt || 0).getTime();
      const right = new Date(b.completedAt || b.startedAt || 0).getTime();
      return right - left;
    });

    await this.executionModel.updateOne(
      { _id: new Types.ObjectId(executionId), 'taskResults.taskId': taskId },
      { $set: { 'taskResults.$.stepExecutions': stepExecutions } },
    ).exec();
  }

  /**
   * Build context string from taskOutputs and incoming edges.
   * Dual-path: typed port resolution (new) with legacy fallback.
   */
  private gatherContext(
    task: any,
    taskOutputs: Map<string, string>,
    snapshot: any,
  ): string {
    const contextParts: string[] = [];
    const coveredSourceIds = new Set<string>();

    if (task.inputPorts && task.inputPorts.length > 0 && snapshot?.edges) {
      const inputPortsById = new Map<string, any>();
      for (const port of task.inputPorts) {
        inputPortsById.set(port.id, port);
      }

      for (const edge of snapshot.edges) {
        if (edge.targetId !== task.id) continue;

        const sourcePortId = edge.sourceOutputPortId || 'default';
        const targetPortId = edge.targetInputPortId || 'default';
        const parentOutput = taskOutputs.get(`${edge.sourceId}:${sourcePortId}`) || taskOutputs.get(edge.sourceId);

        if (parentOutput) {
          const targetPort = inputPortsById.get(targetPortId);
          const label = targetPort?.name || sourcePortId;
          contextParts.push(`[${label}]:\n${parentOutput}`);
          coveredSourceIds.add(edge.sourceId);
        }
      }
    }

    if (task.inputKeys && task.inputKeys.length > 0) {
      for (const key of task.inputKeys) {
        const output = taskOutputs.get(key);
        if (output) contextParts.push(`[${key}]: ${output}`);
      }
    }

    if (snapshot?.edges) {
      for (const edge of snapshot.edges) {
        if (edge.targetId === task.id && !coveredSourceIds.has(edge.sourceId)) {
          const parentOutput = taskOutputs.get(edge.sourceId);
          if (parentOutput && !contextParts.some((p) => p.includes(parentOutput))) {
            contextParts.push(parentOutput);
          }
        }
      }
    }

    return contextParts.join('\n\n');
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
    const currentExecution = await this.executionModel.findById(executionId).select('taskResults').lean().exec();
    const skippedTaskIds: string[] = (currentExecution?.taskResults || [])
      .filter((tr: any) => tr.status === StepStatus.PENDING)
      .map((tr: any) => tr.taskId);

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.FAILED,
        error,
        durationMs,
        completedAt: new Date(),
      },
    });

    // Bulk skip all PENDING taskResults
    const skipResult = await this.executionModel.updateOne(
      { _id: executionId },
      { $set: { 'taskResults.$[elem].status': StepStatus.SKIPPED } },
      { arrayFilters: [{ 'elem.status': StepStatus.PENDING }] },
    );

    this.logger.log('Remaining pending tasks skipped', {
      executionId,
      modifiedCount: skipResult.modifiedCount,
      skippedTaskIds,
    });

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_complete',
      data: { executionId, status: ExecutionStatus.FAILED, error, durationMs, skippedTaskIds },
    });
    this.logger.log('SSE playbook_execution_complete sent (FAILED)', { executionId, userId });
    this.notifyScheduledRunFinished(userId, executionId, 'failed', error);
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

    this.logger.log('Marking execution COMPLETED', { executionId, durationMs });

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.COMPLETED,
        durationMs,
        completedAt: new Date(),
      },
    });

    this.streamGateway.sendToUser(userId, {
      type: 'playbook_execution_complete',
      data: { executionId, status: ExecutionStatus.COMPLETED, durationMs },
    });
    this.logger.log('SSE playbook_execution_complete sent (COMPLETED)', { executionId, userId, durationMs });
    this.notifyScheduledRunFinished(userId, executionId, 'completed');
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

    this.logger.log('Marking execution CANCELLED', { executionId, durationMs });

    // Fetch taskIds that need to be skipped
    const currentExecution = await this.executionModel.findById(executionId).select('taskResults').lean().exec();
    const skippedTaskIds: string[] = (currentExecution?.taskResults || [])
      .filter((tr: any) => tr.status === StepStatus.PENDING || tr.status === StepStatus.RUNNING)
      .map((tr: any) => tr.taskId);

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.CANCELLED,
        error: 'Execution cancelled by user',
        durationMs,
        completedAt: new Date(),
      },
    });

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
    this.logger.log('SSE playbook_execution_complete sent (CANCELLED)', { executionId, userId });
  }

  async rerunStepInExecution(
    userId: string,
    playbookId: string,
    executionId: string,
    taskId: string,
    runEvaluation: boolean = false,
    executionMode?: 'live' | 'replay_strict' | 'replay_flex' | 'replay_adaptive',
    streamingEnabled: boolean = false,
    userEmail: string = '',
  ): Promise<{ status: string; executionId: string }> {
    const execution = await this.getExecutionForReuse(userId, playbookId, executionId);
    const playbook = await this.playbookService.findRawById(playbookId);
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const currentPlaybookTask = playbook.tasks.find((candidate: any) => candidate.id === taskId);
    if (!currentPlaybookTask) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Selected step does not exist in this playbook');
    }
    if (currentPlaybookTask.enabled === false) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Disabled steps cannot be executed');
    }

    let snapshot = this.refreshSnapshotTask(execution.playbookSnapshot as any, playbook, taskId);
    let taskMap = this.buildTaskMapFromSnapshot(snapshot);
    let task = taskMap.get(taskId);
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: { playbookSnapshot: snapshot },
    });

    const descendants = this.findDescendantTaskIds(snapshot, taskId);
    const ancestors = this.findAncestorTaskIds(snapshot, taskId);
    const attemptNumber = (execution.currentAttemptNumber ?? 1) + 1;

    const workspaceIds = (playbook.workspaces || []).map((w: any) => w.toString());
    const workspaceContexts = await this.contextService.buildWorkspaceContexts(workspaceIds);
    const playbookSessionId = `playbook:${playbookId}:execution:${execution.executionNumber}:attempt:${attemptNumber}`;
    const grpcAgentMap = await this.resolveGrpcAgentsForTasks(userId, snapshot?.tasks || [], playbookSessionId);
    await this.ensureTaskResultExists(executionId, task, snapshot, grpcAgentMap, attemptNumber);

    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: { runEvaluation },
    });

    await this.prepareExecutionForRerun(executionId, taskId, attemptNumber);
    await this.resetTaskForAttempt(executionId, taskId, attemptNumber);
    await this.resetTasksForRecompute(executionId, descendants, taskId, attemptNumber);
    await this.appendAttemptHistory(executionId, attemptNumber, 'rerun_step', taskId, null);

    const taskOutputs = this.seedTaskOutputsFromExecution(execution, snapshot, ancestors);
    const startedAt = new Date();
    const selectedExecutionMode = executionMode || (task as any).stepReplayMode || 'live';
    const validatedReplay = selectedExecutionMode !== 'live'
      ? await this.replayService.getActiveReplay(playbookId, taskId)
      : null;

    // Merge current playbook task inputFiles into the snapshot task for rerun
    const taskForExecution = { ...task };
    if (currentPlaybookTask?.inputFiles && currentPlaybookTask.inputFiles.length > 0) {
      taskForExecution.inputFiles = currentPlaybookTask.inputFiles;
      this.logger.log('Using current playbook task inputFiles for rerun', {
        executionId,
        taskId,
        inputFilesCount: currentPlaybookTask.inputFiles.length,
      });
    }

    this.executeStep(
      userId,
      executionId,
      playbookId,
      taskForExecution,
      grpcAgentMap,
      taskOutputs,
      snapshot,
      workspaceContexts,
      userEmail,
      playbook.name,
      selectedExecutionMode,
      validatedReplay,
      runEvaluation,
      streamingEnabled,
    ).then(async (outcome) => {
      if (outcome.outcome === 'completed' || outcome.outcome === 'skipped') {
        if (outcome.outcome === 'completed' && runEvaluation) {
          try {
            await this.semanticEnrichmentService.evaluateNow(userId, executionId, taskId);
          } catch (error) {
            this.logger.warn('Manual semantic evaluation failed after step completion', {
              executionId,
              taskId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
        await this.markExecutionCompleted(userId, executionId, startedAt);
        return;
      }
      if (outcome.outcome === 'interrupted') {
        const interrupt = outcome.response?.interrupt;
        await this.executionModel.findByIdAndUpdate(executionId, {
          $set: {
            status: ExecutionStatus.INTERRUPTED,
            threadId: outcome.response?.thread_id || null,
            interruptPayload: interrupt
              ? {
                  type: interrupt.type,
                  taskId: interrupt.task_id,
                  taskTitle: interrupt.task_title,
                  message: interrupt.message,
                  threadId: interrupt.thread_id,
                  payloadJson: interrupt.payload_json,
                }
              : null,
          },
        });
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
        return;
      }
      await this.markRemainingSkippedAndFail(userId, executionId, outcome.error || 'Step failed', startedAt);
    }).catch(async (err) => {
      this.logger.error('rerunStepInExecution failed', {
        executionId,
        taskId,
        error: (err as Error).message,
      });
      await this.markRemainingSkippedAndFail(userId, executionId, (err as Error).message, startedAt);
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
    const taskMap = this.buildTaskMapFromSnapshot(snapshot);
    const task = taskMap.get(taskId);
    if (!task) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Selected step does not exist in this execution');
    }

    const descendants = this.findDescendantTaskIds(snapshot, taskId);
    const subgraphIds = [taskId, ...descendants];
    const subgraphIdSet = new Set(subgraphIds);
    const ancestors = this.findAncestorTaskIds(snapshot, taskId);
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
    const grpcAgentMap = await this.resolveGrpcAgentsForTasks(userId, snapshot?.tasks || [], playbookSessionId);
    const taskOutputs = this.seedTaskOutputsFromExecution(execution, snapshot, ancestors);

    const subgraphTasks = (snapshot?.tasks || []).filter((t: any) => subgraphIdSet.has(t.id) && t.enabled !== false);
    const subgraphEdges = (snapshot?.edges || []).filter((edge: any) => {
      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
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
    this.logger.log('stopExecution called', { userId, playbookId, executionId });

    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if (execution.executedBy?.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    // Idempotent: already terminal
    const terminalStatuses = [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED];
    if (terminalStatuses.includes(execution.status as ExecutionStatus)) {
      this.logger.log('stopExecution: already terminal', { executionId, status: execution.status });
      return { status: execution.status };
    }

    const startedAt = execution.startedAt || new Date();

    if (execution.status === ExecutionStatus.INTERRUPTED) {
      // No active stream Ã¢â‚¬â€ cancel directly
      this.logger.log('stopExecution: interrupted, cancelling directly', { executionId });
      await this.markExecutionCancelled(userId, executionId, startedAt);
      return { status: ExecutionStatus.CANCELLED };
    }

    // RUNNING: try gRPC stop (best-effort), then cancel stream
    try {
      await this.grpcService.stopPlaybookWorkflow({ user_context: { user_id: userId, username: userEmail }, thread_id: execution.threadId || '' });
    } catch (err) {
      this.logger.warn('StopPlaybookWorkflow gRPC failed (best-effort)', { executionId, error: (err as Error).message });
    }

    const activeCall = this.grpcService.getStream(executionId);
    if (activeCall) {
      this.grpcService.markCancelled(executionId);
      activeCall.cancel();
      this.logger.log('stopExecution: cancelled active stream', { executionId });
    } else {
      // No active stream (race condition) Ã¢â‚¬â€ cancel directly
      this.logger.log('stopExecution: no active stream, cancelling directly', { executionId });
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

    const interruptTaskId = execution.interruptPayload?.taskId || '';
    if (!interruptTaskId || interruptTaskId !== taskId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only the currently interrupted step can be skipped');
    }

    return this.resumeExecution(userId, playbookId, {
      executionId,
      taskId,
      approved: false,
      reason: SKIP_STEP_REASON,
    }, userEmail);
  }

  async resumeExecution(
    userId: string,
    playbookId: string,
    dto: ResumePlaybookDto,
    userEmail: string = '',
  ): Promise<{ status: string }> {
    const action = this.normalizeResumeAction(dto);
    const message = this.normalizeResumeMessage(dto);
    this.logger.log('resumeExecution called', {
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

    // Build structured HumanResponse for gRPC
    const grpcRequest = {
      user_context: { user_id: userId, username: userEmail },
      playbook_id: playbookId,
      thread_id: execution.threadId,
      human_response: {
        action,
        message,
        approved: dto.approved ?? action === 'approve',
        reason: dto.reason || '',
        feedback: dto.feedback || '',
      },
      task_id: dto.taskId,
    };

    this.logger.log('Resume mode determined', {
      executionId,
      isSingleStep,
      threadId: execution.threadId,
    });

    // Mark feedback as answered in DB
    await this.updateHumanFeedbackResponse(executionId, dto.taskId, {
      action,
      message,
      approved: dto.approved,
      reason: dto.reason,
      feedback: dto.feedback,
    });
    this.logger.log('Human feedback response updated in DB', { executionId, taskId: dto.taskId });

    const attemptNumber = (execution.currentAttemptNumber ?? 1) + 1;
    await this.appendAttemptHistory(executionId, attemptNumber, 'resume_interrupt', dto.taskId, execution.threadId || null);

    // Set status back to RUNNING
    await this.executionModel.findByIdAndUpdate(executionId, {
      $set: {
        status: ExecutionStatus.RUNNING,
        interruptPayload: null,
        currentAttemptNumber: attemptNumber,
      },
    });

    if (isSingleStep) {
      // ResumeStep is still unary Ã¢â‚¬â€ process synchronously
      const rpcName = 'ResumeStep';
      this.logger.log(`${rpcName} gRPC request built`, {
        executionId, taskId: dto.taskId, playbookId, threadId: execution.threadId,
      });

      try {
        const resumeStartTime = Date.now();
        const response = await this.grpcService.resumeStep(grpcRequest);
        const resumeDurationMs = Date.now() - resumeStartTime;

        this.logger.log(`${rpcName} gRPC response received`, {
          executionId, responseStatus: response.status, resumeDurationMs,
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
              status: StepStatus.COMPLETED, output, components: mergedComponents,
              semanticMatch,
              toolTrace,
              llmPromptTrace,
              durationMs, startedAt: new Date(), completedAt: new Date(),
            });
              this.streamGateway.sendToUser(userId, {
                type: 'playbook_step_complete',
                data: { executionId, taskId, status: 'completed', output, components: mergedComponents, toolTrace, llmPromptTrace, semanticMatch, durationMs },
              });
          this.scheduleSemanticEvaluation(userId, executionId, taskId, 'completed', evalEnabled);
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
              data: { executionId, taskId, status: 'skipped', output: '', toolTrace, llmPromptTrace, semanticMatch, durationMs },
            });
            } else if (result.status === 'failed') {
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_start',
              data: { executionId, taskId, status: 'running' },
            });
            const error = result.error || 'Step failed';
            await this.updateTaskResult(executionId, taskId, {
              status: StepStatus.FAILED, error, components: mergedComponents,
              semanticMatch,
              toolTrace,
              llmPromptTrace,
              durationMs, startedAt: new Date(), completedAt: new Date(),
            });
            this.streamGateway.sendToUser(userId, {
              type: 'playbook_step_complete',
              data: { executionId, taskId, status: 'failed', error, toolTrace, llmPromptTrace, semanticMatch, durationMs },
            });
          }
        }

        if (response.status === 'completed' || response.status === 'skipped') {
          await this.markExecutionCompleted(userId, executionId, startedAt);
        } else if (response.status === 'suspended') {
          const interrupt = response.interrupt;
          const unaryTaskMap = new Map<string, any>();
          const snap = execution.playbookSnapshot as any;
          if (snap?.tasks) { for (const t of snap.tasks) unaryTaskMap.set(t.id, t); }
          await this.handleStreamInterrupts(userId, executionId, [{
            interrupt,
            threadId: response.thread_id || execution.threadId!,
          }], unaryTaskMap, '', playbookId);
        } else {
          this.logger.error(`${rpcName} failed with non-completed, non-interrupted status`, {
            executionId,
            status: response.status,
            error: response.result?.error || response.error || 'Unknown error',
            response: JSON.stringify(response),
          });
          await this.markRemainingSkippedAndFail(userId, executionId, response.error || 'Resume failed', startedAt);
        }
        return { status: 'resumed' };
      } catch (error) {
        this.logger.error(`${rpcName} gRPC call failed`, {
          executionId, taskId: dto.taskId, error: (error as Error).message,
        });
        throw error;
      }
    }

    // Full workflow: fire-and-forget stream
    this.logger.log('ResumePlaybookWorkflow stream request built', {
      executionId, taskId: dto.taskId, playbookId, threadId: execution.threadId,
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

    const call = this.grpcService.resumePlaybookWorkflow(grpcRequest);
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
   * Status weight for merge priority: higher weight wins.
   */
  private static readonly STATUS_WEIGHT: Record<string, number> = {
    [StepStatus.PENDING]: 0,
    [StepStatus.RUNNING]: 1,
    [StepStatus.COMPLETED]: 2,
    [StepStatus.FAILED]: 2,
    [StepStatus.SKIPPED]: 2,
  };

  /**
   * Merge a single DB task result with in-memory buffer data.
   * Buffer wins when its status weight >= DB status weight.
   */
  private mergeTaskResultWithBuffer(
    dbTr: any,
    buffered: BufferedStepResult,
  ): any {
    const dbWeight = PlaybookExecutionService.STATUS_WEIGHT[dbTr.status] ?? 0;
    const bufWeight = PlaybookExecutionService.STATUS_WEIGHT[buffered.status] ?? 0;
    if (bufWeight < dbWeight) return dbTr;

    return {
      ...dbTr,
      status: buffered.status,
      output: buffered.output !== undefined ? buffered.output : dbTr.output,
      error: buffered.error !== undefined ? buffered.error : dbTr.error,
      durationMs: buffered.durationMs !== undefined ? buffered.durationMs : dbTr.durationMs,
      startedAt: buffered.startedAt !== undefined ? buffered.startedAt : dbTr.startedAt,
      completedAt: buffered.completedAt !== undefined ? buffered.completedAt : dbTr.completedAt,
      components: buffered.components !== undefined ? buffered.components : dbTr.components,
      toolTrace: buffered.toolTrace !== undefined ? buffered.toolTrace : dbTr.toolTrace,
      llmPromptTrace: (buffered as any).llmPromptTrace !== undefined ? (buffered as any).llmPromptTrace : dbTr.llmPromptTrace,
      inputTokens: buffered.inputTokens !== undefined ? buffered.inputTokens : dbTr.inputTokens,
      outputTokens: buffered.outputTokens !== undefined ? buffered.outputTokens : dbTr.outputTokens,
      totalTokens: buffered.totalTokens !== undefined ? buffered.totalTokens : dbTr.totalTokens,
      modelName: buffered.modelName !== undefined ? buffered.modelName : dbTr.modelName,
      semanticMatch: buffered.semanticMatch !== undefined ? buffered.semanticMatch : dbTr.semanticMatch,
      evaluationHistory: buffered.evaluationHistory !== undefined ? buffered.evaluationHistory : dbTr.evaluationHistory,
      stepExecutions: dbTr.stepExecutions || [],
      artifacts: (buffered as any).artifacts !== undefined ? (buffered as any).artifacts : dbTr.artifacts,
    };
  }

  /**
   * Find all active (running or interrupted) executions for a given user.
   * Merges in-memory step buffers so catch-up reads (F5, new tab) are fresh
   * without requiring extra DB writes during streaming.
   */
  async findActiveExecutionsByUser(userId: string): Promise<any[]> {
    const executions = await this.executionModel.find({
      executedBy: new Types.ObjectId(userId),
      status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
    }).lean().exec();

    return executions.map((e: any) => {
      const executionId = (e._id || e.id).toString();
      const buffer = this.activeStepBuffers.get(executionId);

        return {
          id: executionId,
          playbookId: e.playbookId.toString(),
          executedBy: e.executedBy.toString(),
          executionNumber: e.executionNumber,
          currentAttemptNumber: e.currentAttemptNumber ?? 1,
          status: e.status,
          executionMode: e.executionMode || 'live',
          replaySourceByTask: e.replaySourceByTask || null,
          attemptHistory: e.attemptHistory || [],
          taskResults: (e.taskResults || []).map((tr: any) => {
            const merged = buffer?.has(tr.taskId)
              ? this.mergeTaskResultWithBuffer(tr, buffer.get(tr.taskId)!)
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
              evaluationHistory: (merged.evaluationHistory || []).map((entry: any) => ({
                ...entry,
                createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
              })),
              stepExecutions: (merged.stepExecutions || []).map((entry: any) => ({
                ...entry,
                startedAt: entry.startedAt?.toISOString?.() || entry.startedAt || null,
                completedAt: entry.completedAt?.toISOString?.() || entry.completedAt || null,
              })),
              attemptNumber: merged.attemptNumber ?? 1,
              isStale: merged.isStale ?? false,
              staleReason: merged.staleReason ?? null,
              invalidatedByTaskId: merged.invalidatedByTaskId ?? null,
            };
          }),
        threadId: e.threadId,
        interruptPayload: e.interruptPayload,
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

    this.logger.log('Appending humanFeedback component', {
      executionId,
      taskId,
      componentId: component.id,
      interruptType: data.interruptType,
    });

    await this.executionModel.updateOne(
      { _id: executionId, 'taskResults.taskId': taskId },
      { $push: { 'taskResults.$.components': { $each: [component], $slice: -this.maxComponentsPerTask } } },
    );
  }

  /**
   * Update the latest pending humanFeedback component with the user's structured response.
   */
  private async updateHumanFeedbackResponse(
    executionId: string,
    taskId: string,
    response: { action: string; message?: string; approved?: boolean; reason?: string; feedback?: string },
  ): Promise<void> {
    this.logger.log('Updating humanFeedback response', {
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
      this.logger.warn('updateHumanFeedbackResponse: task result not found', { executionId, taskId });
      return;
    }

    const components = taskResult.components || [];
    // Find the last pending humanFeedback component
    for (let i = components.length - 1; i >= 0; i--) {
      const comp = components[i] as any;
      if (comp.type === 'humanFeedback' && comp.data?.status === 'pending') {
        comp.data.status = 'answered';
        comp.data.action = response.action;
        comp.data.replyMessage = response.message || '';
        comp.data.approved = response.approved;
        comp.data.reason = response.reason || '';
        comp.data.feedback = response.feedback || '';
        comp.data.humanResponse = response.action === 'approve'
          ? 'approved'
          : response.action === 'reject'
            ? 'rejected'
            : response.action === 'reply'
              ? 'replied'
              : response.action;
        break;
      }
    }

    taskResult.components = components;
    execution.markModified('taskResults');
    await execution.save();
  }
}
