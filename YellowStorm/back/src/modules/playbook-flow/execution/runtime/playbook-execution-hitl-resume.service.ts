import { Injectable, Optional } from '@nestjs/common';
import {
  ExecutionRepository,
  toExecutionJson,
  type ExecutionRecord,
  type PendingApprovalMatch,
} from '../../persistence/execution.repository';
import { HitlMemoryRepository } from '../../persistence/hitl-memory.repository';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';
import { FlowAccessService } from '../../domain/flow-access.service';
import { toGrpcStruct } from '../grpc/grpc-struct.mapper';
import { ErrorCode } from '../../../exceptions/constants/error-codes';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '../../../exceptions/exceptions/http.exceptions';
import {
  IFlowExecutionResponse,
  IResumeApprovalPayload,
  IResumeFromStepPayload,
} from '../../interfaces/playbook-flow-execution.interface';

export type ResumeRuntimeCallback = (
  request: Record<string, unknown>,
  callback: (err: Error | null, response?: { resumed?: boolean }) => void,
) => void;

/**
 * Host callbacks owned by PlaybookFlowExecutionService so durable resume can
 * restart a Run stream without pulling callGrpcRun into this collaborator.
 */
export interface PlaybookExecutionHitlResumeHost {
  isRuntimeAvailable(): boolean;
  resumeApprovalRuntime: ResumeRuntimeCallback;
  resumeFromStepRuntime: ResumeRuntimeCallback;
  scheduleDurableResume(ownerId: string): void;
}

/** The response of a resume: the run as read before the resume, with the fields the resume changed. */
function executionResponse(execution: ExecutionRecord, changes: Partial<ExecutionRecord> = {}): IFlowExecutionResponse {
  return toExecutionJson({ ...execution, ...changes }) as unknown as IFlowExecutionResponse;
}

/**
 * HITL interrupt resume and durable restart.
 *
 * The execution service remains the orchestration entry point; this service
 * owns approval/step resume, future-memory persistence, and durable restart
 * when the runtime no longer holds interrupt state.
 */
@Injectable()
export class PlaybookExecutionHitlResumeService {
  private host?: PlaybookExecutionHitlResumeHost;

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
    @Optional() private readonly hitlMemoryRepository?: HitlMemoryRepository,
    @Optional() private readonly accessService?: FlowAccessService,
  ) {}

  bindExecutionHost(host: PlaybookExecutionHitlResumeHost): void {
    this.host = host;
  }

  async resumeApproval(
    executionId: string,
    ownerId: string,
    payload: IResumeApprovalPayload,
  ): Promise<IFlowExecutionResponse> {
    const host = this.requireHost();
    const execution = await this.findExecutionWithSnapshot(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      await this.requireAccessService().assertExecutionAccess(String(execution.flowId), ownerId, 'write');
    }
    if (execution.status !== 'pending_approval') {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }

    if (!host.isRuntimeAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const pendingApproval = execution.pendingApproval;
    const interruptId = pendingApproval?.interruptId ?? '';
    // The claim holds only while the run still waits on this exact approval.
    const claimedApproval: PendingApprovalMatch = {
      nodeId: pendingApproval?.nodeId ?? '',
      iteration: pendingApproval?.iteration ?? 0,
      ...(interruptId ? { interruptId } : {}),
    };
    const releaseClaim = () => this.executionRepository.transition(executionId, {
      from: ['running'],
      pendingApproval: claimedApproval,
      patch: { status: 'pending_approval' },
    });

    const claimed = await this.executionRepository.transition(executionId, {
      from: ['pending_approval'],
      pendingApproval: claimedApproval,
      patch: { status: 'running' },
    });
    if (!claimed) {
      return this.latestExecutionResponse(executionId);
    }

    let resumed: boolean;
    try {
      resumed = await new Promise<boolean>((resolve, reject) => {
        host.resumeApprovalRuntime(
          {
            execution_id: executionId,
            decision: payload.decision,
            payload: toGrpcStruct(payload.payload || {}),
          },
          (err: Error | null, response?: { resumed?: boolean }) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(Boolean(response?.resumed));
          },
        );
      });
    } catch (error) {
      await releaseClaim();
      throw error;
    }

    if (!resumed) {
      const restarted = await this.restartDurableApprovalResume({
        execution,
        executionId,
        ownerId,
        resumePayload: { decision: payload.decision, payload: payload.payload || {} },
        response: {
          action: payload.decision,
          ...(payload.payload ?? {}),
        },
      });
      if (restarted) {
        return restarted;
      }
      await releaseClaim();
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending approval state.',
      );
    }

    const answered = await this.executionRepository.answerHitlEvent(executionId, {
      from: ['running'],
      pendingApproval: claimedApproval,
      interruptId,
      response: {
        action: payload.decision,
        ...(payload.payload ?? {}),
      },
      patch: { status: 'running', pendingApproval: null },
    });

    if (!answered) {
      return this.latestExecutionResponse(executionId);
    }

    const resolvedApproval = pendingApproval;
    await this.createFutureHitlMemoryIfRequested({
      executionId,
      ownerId,
      flowId: String(execution.flowId),
      taskId: resolvedApproval?.nodeId ?? '',
      interruptId: resolvedApproval?.interruptId ?? '',
      interruptType: resolvedApproval?.interruptType ?? 'approval_request',
      taskTitle: resolvedApproval?.taskTitle,
      response: {
        action: payload.decision,
        message: typeof payload.payload?.message === 'string' ? payload.payload.message : null,
        feedback: typeof payload.payload?.feedback === 'string' ? payload.payload.feedback : null,
        reason: typeof payload.payload?.reason === 'string' ? payload.payload.reason : null,
        scope: typeof payload.payload?.scope === 'string'
          ? payload.payload.scope
          : resolvedApproval?.feedbackScopeDefault ?? 'step_only',
        remember: payload.payload?.remember === true,
      },
      riskLevel: resolvedApproval?.riskLevel,
    });
    this.streamEvents.emitHitlInterruptResolved(executionId, resolvedApproval?.interruptId ?? '', {
      action: payload.decision,
      taskId: resolvedApproval?.nodeId,
      scope: typeof payload.payload?.scope === 'string' ? payload.payload.scope : undefined,
      remember: payload.payload?.remember === true ? true : undefined,
    });
    return executionResponse(execution, { pendingApproval: null, status: 'running' });
  }

  async resumeFromStep(
    executionId: string,
    ownerId: string,
    payload: IResumeFromStepPayload,
  ): Promise<IFlowExecutionResponse> {
    const host = this.requireHost();
    const execution = await this.findExecutionWithSnapshot(executionId);
    if (!execution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (String(execution.ownerId) !== String(ownerId)) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    if (execution.status !== 'pending_approval' || !execution.pendingApproval) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_APPROVAL_NOT_FOUND,
        'No pending approval for this execution',
      );
    }
    if (execution.pendingApproval.nodeId !== payload.taskId) {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution is waiting on a different step interrupt.',
      );
    }

    const snapshotNodes = execution.snapshot?.nodes;
    if (Array.isArray(snapshotNodes) && snapshotNodes.some(
      (node: { id?: string; kind?: string } | null) => node?.id === payload.taskId && node.kind === 'human_approval',
    )) {
      if (payload.interruptId && execution.pendingApproval.interruptId
        && payload.interruptId !== execution.pendingApproval.interruptId) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Execution is waiting on a different approval interrupt.');
      }
      const decision = payload.action === 'approve' ? 'approved'
        : payload.action === 'reject' ? 'rejected' : null;
      if (!decision || (payload.approved !== undefined && payload.approved !== (decision === 'approved'))) {
        throw new BadRequestException(ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED, 'Approval decision must be approved or rejected.');
      }
      return this.resumeApproval(executionId, ownerId, {
        decision,
        payload: {
          ...payload.payload,
          ...(payload.message ? { message: payload.message } : {}),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(payload.feedback ? { feedback: payload.feedback } : {}),
          ...(payload.scope ? { scope: payload.scope } : {}),
          ...(payload.remember !== undefined ? { remember: payload.remember } : {}),
        },
      });
    }

    if (!host.isRuntimeAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE,
        'Flow runtime is currently unavailable',
      );
    }

    const resumePayload = {
      ...(payload.payload || {}),
      ...(payload.action ? { action: payload.action } : {}),
      ...(payload.message ? { message: payload.message } : {}),
      ...(payload.approved !== undefined ? { approved: payload.approved } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
      ...(payload.feedback ? { feedback: payload.feedback } : {}),
      ...(payload.scope ? { scope: payload.scope } : {}),
      ...(payload.remember !== undefined ? { remember: payload.remember } : {}),
      ...(execution.pendingApproval.interruptPayload?.request_fingerprint
        ? { request_fingerprint: String(execution.pendingApproval.interruptPayload.request_fingerprint) }
        : {}),
    };

    const resumed = await new Promise<boolean>((resolve, reject) => {
      host.resumeFromStepRuntime(
        {
          execution_id: executionId,
          node_id: payload.taskId,
          iteration: payload.iteration ?? execution.pendingApproval?.iteration ?? 0,
          interrupt_id: payload.interruptId || '',
          action: payload.action || '',
          payload: toGrpcStruct(resumePayload),
        },
        (err: Error | null, response?: { resumed?: boolean }) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(Boolean(response?.resumed));
        },
      );
    });

    if (!resumed) {
      const restarted = await this.restartDurableStepResume({
        execution,
        executionId,
        ownerId,
        taskId: payload.taskId,
        interruptId: payload.interruptId || execution.pendingApproval.interruptId || '',
        resumePayload,
        response: {
          action: payload.action ?? 'reply',
          message: payload.message ?? null,
          approved: payload.approved ?? null,
          reason: payload.reason ?? null,
          feedback: payload.feedback ?? null,
          scope: payload.scope ?? execution.pendingApproval.feedbackScopeDefault ?? 'step_only',
          remember: payload.remember ?? false,
        },
      });
      if (restarted) {
        return restarted;
      }
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'Execution could not be resumed because the runtime no longer has the pending step interrupt state.',
      );
    }

    const answered = await this.executionRepository.answerHitlEvent(executionId, {
      from: ['pending_approval'],
      interruptId: payload.interruptId || execution.pendingApproval.interruptId || '',
      response: {
        action: payload.action ?? 'reply',
        message: payload.message ?? null,
        approved: payload.approved ?? null,
        reason: payload.reason ?? null,
        feedback: payload.feedback ?? null,
        scope: payload.scope ?? execution.pendingApproval.feedbackScopeDefault ?? 'step_only',
        remember: payload.remember ?? false,
      },
      patch: { status: 'running', pendingApproval: null },
    });

    if (!answered) {
      return this.latestExecutionResponse(executionId);
    }

    const resolvedApproval = execution.pendingApproval;
    await this.createFutureHitlMemoryIfRequested({
      executionId,
      ownerId,
      flowId: String(execution.flowId),
      taskId: payload.taskId,
      interruptId: payload.interruptId || resolvedApproval?.interruptId || '',
      interruptType: resolvedApproval?.interruptType,
      taskTitle: resolvedApproval?.taskTitle,
      response: {
        action: payload.action ?? 'reply',
        message: payload.message ?? null,
        feedback: payload.feedback ?? null,
        reason: payload.reason ?? null,
        scope: payload.scope ?? resolvedApproval?.feedbackScopeDefault ?? 'step_only',
        remember: payload.remember ?? false,
      },
      riskLevel: resolvedApproval?.riskLevel,
    });
    this.streamEvents.emitHitlInterruptResolved(executionId, payload.interruptId || resolvedApproval?.interruptId || '', {
      action: payload.action ?? 'reply',
      taskId: payload.taskId,
      scope: payload.scope,
      remember: payload.remember,
    });
    return executionResponse(execution, { pendingApproval: null, status: 'running' });
  }

  private requireHost(): PlaybookExecutionHitlResumeHost {
    if (!this.host) {
      throw new Error('PlaybookExecutionHitlResumeService host is not bound');
    }
    return this.host;
  }

  private requireAccessService(): FlowAccessService {
    if (!this.accessService) {
      throw new Error('FlowAccessService is required for playbook execution authorization');
    }
    return this.accessService;
  }

  private findExecutionWithSnapshot(executionId: string): Promise<ExecutionRecord | null> {
    return this.executionRepository.findById(executionId, { withSnapshot: true });
  }

  /** A lost race: another request already moved the run on; answer with its current state. */
  private async latestExecutionResponse(executionId: string): Promise<IFlowExecutionResponse> {
    const latestExecution = await this.executionRepository.findById(executionId);
    if (!latestExecution) {
      throw new NotFoundException(
        ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND,
        'Execution not found',
      );
    }
    return executionResponse(latestExecution);
  }

  private async restartDurableApprovalResume(params: {
    execution: ExecutionRecord;
    executionId: string;
    ownerId: string;
    resumePayload: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<IFlowExecutionResponse | null> {
    const pendingApproval = params.execution.pendingApproval;
    if (!params.execution.snapshot || !pendingApproval) {
      return null;
    }
    const resumed = await this.persistDurableResume(
      params.execution,
      params.executionId,
      pendingApproval.interruptId ?? '',
      params.resumePayload,
      params.response,
    );
    if (!resumed) return null;

    await this.createFutureHitlMemoryIfRequested({
      executionId: params.executionId,
      ownerId: params.ownerId,
      flowId: String(params.execution.flowId),
      taskId: pendingApproval.nodeId ?? '',
      interruptId: pendingApproval.interruptId ?? '',
      interruptType: pendingApproval.interruptType ?? 'approval_request',
      taskTitle: pendingApproval.taskTitle,
      response: {
        action: String(params.response.action ?? ''),
        message: typeof params.response.message === 'string' ? params.response.message : null,
        feedback: typeof params.response.feedback === 'string' ? params.response.feedback : null,
        reason: typeof params.response.reason === 'string' ? params.response.reason : null,
        scope: typeof params.response.scope === 'string' ? params.response.scope : pendingApproval.feedbackScopeDefault ?? 'step_only',
        remember: params.response.remember === true,
      },
      riskLevel: pendingApproval.riskLevel,
    });
    this.requireHost().scheduleDurableResume(String(params.execution.ownerId));
    this.streamEvents.emitHitlInterruptResolved(params.executionId, pendingApproval.interruptId ?? '', {
      action: String(params.response.action ?? ''),
      taskId: pendingApproval.nodeId,
      scope: typeof params.response.scope === 'string' ? params.response.scope : undefined,
      remember: params.response.remember === true ? true : undefined,
    });
    return executionResponse(params.execution, { pendingApproval: null, status: 'queued' });
  }

  private async restartDurableStepResume(params: {
    execution: ExecutionRecord;
    executionId: string;
    ownerId: string;
    taskId: string;
    interruptId: string;
    resumePayload: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<IFlowExecutionResponse | null> {
    const pendingApproval = params.execution.pendingApproval;
    if (!params.execution.snapshot || !pendingApproval) {
      return null;
    }
    const resumed = await this.persistDurableResume(
      params.execution,
      params.executionId,
      params.interruptId,
      params.resumePayload,
      params.response,
    );
    if (!resumed) return null;

    await this.createFutureHitlMemoryIfRequested({
      executionId: params.executionId,
      ownerId: params.ownerId,
      flowId: String(params.execution.flowId),
      taskId: params.taskId,
      interruptId: params.interruptId,
      interruptType: pendingApproval.interruptType,
      taskTitle: pendingApproval.taskTitle,
      response: {
        action: String(params.response.action ?? 'reply'),
        message: typeof params.response.message === 'string' ? params.response.message : null,
        feedback: typeof params.response.feedback === 'string' ? params.response.feedback : null,
        reason: typeof params.response.reason === 'string' ? params.response.reason : null,
        scope: typeof params.response.scope === 'string' ? params.response.scope : pendingApproval.feedbackScopeDefault ?? 'step_only',
        remember: params.response.remember === true,
      },
      riskLevel: pendingApproval.riskLevel,
    });
    this.requireHost().scheduleDurableResume(String(params.execution.ownerId));
    this.streamEvents.emitHitlInterruptResolved(params.executionId, params.interruptId, {
      action: String(params.response.action ?? 'reply'),
      taskId: params.taskId,
      scope: typeof params.response.scope === 'string' ? params.response.scope : undefined,
      remember: params.response.remember === true ? true : undefined,
    });
    return executionResponse(params.execution, { pendingApproval: null, status: 'queued' });
  }

  /** Re-queues the run with the human answer in its input so the runtime restarts it from the snapshot. */
  private persistDurableResume(
    execution: ExecutionRecord,
    executionId: string,
    interruptId: string,
    resumePayload: Record<string, unknown>,
    response: Record<string, unknown>,
  ): Promise<boolean> {
    return this.executionRepository.answerHitlEvent(executionId, {
      from: ['running', 'pending_approval'],
      interruptId,
      response,
      patch: {
        status: 'queued',
        queuePosition: 0,
        pendingApproval: null,
        inputContext: {
          ...(execution.inputContext ?? {}),
          __playbook_resume: resumePayload,
        },
      },
    });
  }

  private async createFutureHitlMemoryIfRequested(params: {
    executionId: string;
    ownerId: string;
    flowId: string;
    taskId: string;
    interruptId: string;
    interruptType?: string;
    taskTitle?: string;
    response: {
      action: string;
      message?: string | null;
      feedback?: string | null;
      reason?: string | null;
      scope: string;
      remember: boolean;
    };
    riskLevel?: string;
  }): Promise<void> {
    if (!this.hitlMemoryRepository || !params.response.remember) {
      return;
    }
    if (params.response.scope !== 'future_node_runs' && params.response.scope !== 'future_workflow_runs') {
      return;
    }

    const content = params.response.feedback || params.response.message || params.response.reason || '';
    if (!content.trim()) {
      return;
    }

    await this.hitlMemoryRepository.create({
      ownerId: params.ownerId,
      flowId: params.flowId,
      nodeId: params.response.scope === 'future_node_runs' ? params.taskId : null,
      memoryType: params.interruptType === 'approval_request' ? 'approval_policy' : 'procedural',
      source: 'hitl_feedback',
      title: this.buildHitlMemoryTitle(params.taskTitle, params.response.scope),
      content,
      normalizedInstruction: content,
      appliesTo: params.response.scope === 'future_node_runs' ? 'node' : 'workflow',
      status: 'active',
      sensitivity: params.interruptType === 'approval_request' || params.riskLevel === 'high' || params.riskLevel === 'critical'
        ? 'sensitive'
        : 'normal',
      createdFromExecutionId: params.executionId,
      createdFromInterruptId: params.interruptId || undefined,
    });
    this.streamEvents.emitHitlMemorySaved(params.executionId, {
      taskId: params.taskId,
      scope: params.response.scope,
      interruptId: params.interruptId,
    });
  }

  private buildHitlMemoryTitle(taskTitle: string | undefined, scope: string): string {
    const target = taskTitle?.trim() || 'workflow step';
    return scope === 'future_node_runs'
      ? `HITL guidance for ${target}`
      : 'Workflow HITL guidance';
  }
}
