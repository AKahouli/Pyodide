import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SECOND_BRAIN_MCP_ACTIONS } from '@modules/agent/services/playbook-assistant-connector-reconciler.service';
import { EvaluateMascotToolDto } from '../dto/playbook-assistant.dto';
import { FlowAccessService } from '../domain/flow-access.service';
import { PlaybookAssistantContextService } from './playbook-assistant-context.service';
import {
  PlaybookMascotConfirmation,
  PlaybookMascotConfirmationDocument,
} from '../schemas/playbook-mascot-confirmation.schema';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { UserService } from '@modules/user/user.service';

export interface MascotActorContext {
  tenantId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  correlationId: string;
}

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const CONSUMPTION_RETENTION_MS = 24 * 60 * 60 * 1000;

export type MascotConfirmationConsumption =
  | { kind: 'claimed'; confirmation: PlaybookMascotConfirmationDocument & { continuationCorrelationId: string } }
  | { kind: 'replayed'; result: Record<string, unknown> };

@Injectable()
export class MascotToolExecutionPolicyService {
  constructor(
    @InjectModel(PlaybookMascotConfirmation.name)
    private readonly confirmationModel: Model<PlaybookMascotConfirmationDocument>,
    private readonly accessService: FlowAccessService,
    private readonly contextService: PlaybookAssistantContextService,
    private readonly auditLogService: AuditLogService,
    private readonly userService: UserService,
  ) {}

  async evaluate(actor: MascotActorContext, dto: EvaluateMascotToolDto): Promise<Record<string, unknown>> {
    const actionKey = this.actionKey(dto.toolName);
    if (!SECOND_BRAIN_MCP_ACTIONS.includes(actionKey as (typeof SECOND_BRAIN_MCP_ACTIONS)[number])) {
      await this.audit(actor, 'second_brain.tool.denied', 'failure', { toolName: actionKey, code: 'MASCOT_TOOL_NOT_ALLOWED' });
      return { decision: 'denied', code: 'MASCOT_TOOL_NOT_ALLOWED', message: 'This tool is not enabled for My Second Brain.' };
    }
    if (actionKey !== 'start_playbook_execution') {
      const impact = actionKey === 'start_playbook_generation' ? 'write' : 'read';
      await this.audit(actor, 'second_brain.tool.allowed', 'success', { toolName: actionKey, impact });
      return { decision: 'allowed', impact };
    }

    const canonicalArguments = this.canonicalArguments(dto.arguments);
    const playbookId = typeof canonicalArguments.playbook_id === 'string' ? canonicalArguments.playbook_id : '';
    if (!playbookId) {
      await this.audit(actor, 'second_brain.tool.denied', 'failure', { toolName: actionKey, code: 'MASCOT_INVALID_ARGUMENTS' });
      return { decision: 'denied', code: 'MASCOT_INVALID_ARGUMENTS', message: 'A Playbook identifier is required.' };
    }
    const flow = await this.accessService.findAccessibleFlow(playbookId, actor.userId, 'write');
    const context = await this.contextService.open(playbookId, actor.userId);
    if (context.validation.status === 'blocked') {
      await this.audit(actor, 'second_brain.tool.denied', 'failure', { toolName: actionKey, playbookId, code: 'MASCOT_PLAYBOOK_INVALID' });
      return {
        decision: 'denied',
        code: 'MASCOT_PLAYBOOK_INVALID',
        message: 'The Playbook must pass validation before it can run.',
        uiTarget: { surface: 'playbook.validation', params: { playbookId } },
      };
    }

    const argumentsHash = this.hash(canonicalArguments);
    const activeKey = this.hash({
      tenantId: actor.tenantId,
      userId: actor.userId,
      agentId: actor.agentId,
      conversationId: actor.conversationId,
      toolName: actionKey,
      argumentsHash,
      definitionRevision: flow.definitionRevision ?? 0,
    });
    const now = new Date();
    let existing = await this.confirmationModel.findOne({
      tenantId: actor.tenantId,
      userId: actor.userId,
      agentId: actor.agentId,
      conversationId: actor.conversationId,
      toolName: actionKey,
      argumentsHash,
      status: { $in: ['pending', 'confirmed', 'consuming', 'executing'] },
      expiresAt: { $gt: now },
    }).select('+canonicalArguments +continuationCorrelationId').sort({ createdAt: -1 }).exec();
    const proposedRevision = Number((existing?.summary as { definitionRevision?: unknown } | undefined)?.definitionRevision);
    if (existing && Number.isFinite(proposedRevision) && proposedRevision !== (flow.definitionRevision ?? 0)) {
      await this.confirmationModel.updateOne(
        { _id: existing._id, status: { $in: ['pending', 'confirmed', 'consuming'] } },
        { $set: { status: 'expired' }, $unset: { activeKey: 1 } },
      ).exec();
      existing = null;
    }
    if (existing?.status === 'consuming') {
      const claimed = await this.confirmationModel.findOneAndUpdate(
        {
          _id: existing._id,
          status: 'consuming',
          continuationCorrelationId: actor.correlationId,
          expiresAt: { $gt: now },
        },
        {
          $set: {
            status: 'executing',
            expiresAt: new Date(Date.now() + CONSUMPTION_RETENTION_MS),
          },
        },
        { new: true },
      ).select('+canonicalArguments +continuationCorrelationId').exec();
      if (!claimed) {
        await this.audit(actor, 'second_brain.tool.denied', 'failure', {
          toolName: actionKey,
          playbookId,
          confirmationId: existing.confirmationId,
          code: 'MASCOT_CONFIRMATION_CONSUMED',
        });
        return { decision: 'denied', code: 'MASCOT_CONFIRMATION_CONSUMED', message: 'This confirmation has already been consumed.' };
      }
      dto.arguments.idempotency_key = claimed.idempotencyKey;
      await this.audit(actor, 'second_brain.tool.allowed', 'success', {
        toolName: actionKey,
        impact: 'execute',
        playbookId,
        confirmationId: claimed.confirmationId,
      });
      return {
        decision: 'allowed',
        impact: 'execute',
        confirmationId: claimed.confirmationId,
        idempotencyKey: claimed.idempotencyKey,
      };
    }
    if (existing?.status === 'executing') {
      await this.audit(actor, 'second_brain.tool.denied', 'failure', {
        toolName: actionKey,
        playbookId,
        confirmationId: existing.confirmationId,
        code: 'MASCOT_CONFIRMATION_CONSUMED',
      });
      return { decision: 'denied', code: 'MASCOT_CONFIRMATION_CONSUMED', message: 'This confirmation has already been consumed.' };
    }
    if (existing) {
      await this.audit(actor, 'second_brain.confirmation.requested', 'success', {
        toolName: actionKey,
        playbookId,
        confirmationId: existing.confirmationId,
        reused: true,
      });
      return this.pendingResult(existing);
    }

    await this.confirmationModel.updateOne(
      { activeKey, status: { $in: ['pending', 'confirmed'] }, expiresAt: { $lte: now } },
      { $set: { status: 'expired' }, $unset: { activeKey: 1 } },
    ).exec();

    const confirmationId = randomUUID();
    const setOnInsert = {
      confirmationId,
      activeKey,
      tenantId: actor.tenantId,
      userId: actor.userId,
      agentId: actor.agentId,
      conversationId: actor.conversationId,
      correlationId: actor.correlationId,
      toolName: actionKey,
      argumentsHash,
      canonicalArguments,
      summary: {
        playbookId,
        playbookName: flow.name,
        definitionRevision: flow.definitionRevision ?? 0,
        validationStatus: context.validation.diagnostics.length > 0 ? 'warning' : 'valid',
        inputLabels: Object.keys((canonicalArguments.input_context as Record<string, unknown> | undefined) ?? {}).slice(0, 20),
      },
      idempotencyKey: this.hash({ tenantId: actor.tenantId, userId: actor.userId, confirmationId, argumentsHash }),
      expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
      status: 'pending' as const,
    };
    let created: PlaybookMascotConfirmationDocument | null;
    try {
      created = await this.confirmationModel.findOneAndUpdate(
        { activeKey },
        { $setOnInsert: setOnInsert },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).select('+canonicalArguments').exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      created = await this.confirmationModel.findOne({ activeKey }).select('+canonicalArguments').exec();
    }
    if (!created) throw new ConflictException(ErrorCode.CONFLICT, 'The pending action could not be reserved.');
    await this.audit(actor, 'second_brain.confirmation.requested', 'success', {
      toolName: actionKey,
      playbookId,
      confirmationId: created.confirmationId,
      reused: false,
    });
    return this.pendingResult(created);
  }

  async confirm(userId: string, confirmationId: string): Promise<MascotConfirmationConsumption> {
    const continuationCorrelationId = `second-brain:${randomUUID()}`;
    const confirmation = await this.confirmationModel.findOneAndUpdate(
      { confirmationId, userId, status: { $in: ['pending', 'confirmed'] }, expiresAt: { $gt: new Date() } },
      {
        $set: { status: 'consuming', continuationCorrelationId, consumedAt: new Date() },
        $unset: { activeKey: 1 },
      },
      { new: true },
    ).select('+canonicalArguments +continuationCorrelationId').exec();
    if (confirmation) {
      await this.auditFromConfirmation(confirmation, 'second_brain.confirmation.confirmed', 'success');
      return {
        kind: 'claimed',
        confirmation: confirmation as PlaybookMascotConfirmationDocument & { continuationCorrelationId: string },
      };
    }
    const existing = await this.confirmationModel.findOne({ confirmationId, userId })
      .select('+canonicalArguments +continuationCorrelationId +continuationResult')
      .exec();
    if (!existing) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Confirmation not found');
    if (existing.status === 'executed' && existing.continuationResult) {
      return { kind: 'replayed', result: existing.continuationResult };
    }
    throw new ConflictException(ErrorCode.CONFLICT, 'This confirmation is no longer actionable.');
  }

  async complete(
    userId: string,
    confirmationId: string,
    continuationCorrelationId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const confirmation = await this.confirmationModel.findOneAndUpdate(
      { confirmationId, userId, continuationCorrelationId, status: 'executing' },
      {
        $set: {
          status: 'executed',
          continuationResult: result,
          expiresAt: new Date(Date.now() + CONSUMPTION_RETENTION_MS),
        },
        $unset: { activeKey: 1 },
      },
      { new: true },
    ).exec();
    if (!confirmation) throw new ConflictException(ErrorCode.CONFLICT, 'This confirmation could not be completed.');
    await this.auditFromConfirmation(confirmation, 'second_brain.confirmation.executed', 'success');
  }

  async fail(userId: string, confirmationId: string): Promise<void> {
    const confirmation = await this.confirmationModel.findOneAndUpdate(
      { confirmationId, userId, status: { $in: ['consuming', 'executing'] } },
      {
        $set: { status: 'failed', expiresAt: new Date(Date.now() + CONSUMPTION_RETENTION_MS) },
        $unset: { activeKey: 1 },
      },
      { new: true },
    ).exec();
    if (confirmation) await this.auditFromConfirmation(confirmation, 'second_brain.confirmation.execution_failed', 'failure');
  }

  async reject(userId: string, confirmationId: string): Promise<void> {
    const result = await this.confirmationModel.updateOne(
      { confirmationId, userId, status: 'pending' },
      { $set: { status: 'rejected' }, $unset: { activeKey: 1 } },
    ).exec();
    if (result.modifiedCount !== 1) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'This confirmation cannot be rejected.');
    }
    const confirmation = await this.confirmationModel.findOne({ confirmationId, userId }).exec();
    if (confirmation) await this.auditFromConfirmation(confirmation, 'second_brain.confirmation.rejected', 'success');
  }

  private pendingResult(confirmation: PlaybookMascotConfirmationDocument): Record<string, unknown> {
    return {
      decision: 'confirmation_required',
      impact: 'execute',
      pendingAction: {
        confirmationId: confirmation.confirmationId,
        toolName: confirmation.toolName,
        summary: confirmation.summary,
        expiresAt: confirmation.expiresAt,
        status: confirmation.status,
      },
    };
  }

  private actionKey(toolName: string): string {
    return [...SECOND_BRAIN_MCP_ACTIONS]
      .sort((left, right) => right.length - left.length)
      .find((action) => toolName === action || toolName.endsWith(`_${action}`)) ?? toolName;
  }

  private canonicalArguments(args: Record<string, unknown>): Record<string, unknown> {
    const { idempotency_key: _modelControlledKey, ...canonical } = args;
    return canonical;
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
  }

  private async audit(
    actor: MascotActorContext,
    action: string,
    status: 'success' | 'failure',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const user = await this.userService.findById(actor.userId);
    const params = {
      actorId: actor.userId,
      actorEmail: user?.email ?? 'unknown',
      action,
      targetType: 'second_brain_tool',
      metadata: {
        tenantId: actor.tenantId,
        agentId: actor.agentId,
        conversationId: actor.conversationId,
        correlationId: actor.correlationId,
        ...metadata,
      },
    };
    if (status === 'success') this.auditLogService.logSuccess(params);
    else this.auditLogService.logFailure({ ...params, failureReason: String(metadata.code ?? 'denied') });
  }

  private async auditFromConfirmation(
    confirmation: PlaybookMascotConfirmationDocument,
    action: string,
    status: 'success' | 'failure',
  ): Promise<void> {
    await this.audit({
      tenantId: confirmation.tenantId,
      userId: confirmation.userId,
      agentId: confirmation.agentId,
      conversationId: confirmation.conversationId,
      correlationId: confirmation.correlationId,
    }, action, status, {
      toolName: confirmation.toolName,
      confirmationId: confirmation.confirmationId,
    });
  }
}
