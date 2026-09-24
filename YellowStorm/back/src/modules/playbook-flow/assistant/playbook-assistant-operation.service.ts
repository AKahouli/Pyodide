import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { PlaybookIntentConstructionEvent, PlaybookIntentConstructionStatus } from '../interfaces/playbook-flow-intent-construction.interface';
import { PlaybookAssistantOperation, PlaybookAssistantOperationDocument } from '../schemas/playbook-assistant-operation.schema';
import { PlaybookAssistantRevision, PlaybookAssistantRevisionDocument } from '../schemas/playbook-assistant-revision.schema';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import type { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import type { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';

const TERMINAL_STATUSES: PlaybookIntentConstructionStatus[] = ['completed', 'failed', 'cancelled'];
const RETENTION_MS = 24 * 60 * 60 * 1000;
export const PLAYBOOK_ASSISTANT_WORKER_LEASE_MS = 5 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 30 * 1000;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_OPERATION_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_REVISION_SNAPSHOT_BYTES = 12 * 1024 * 1024;
export type PersistableConstructionEvent = PlaybookIntentConstructionEvent extends infer Event
  ? Event extends PlaybookIntentConstructionEvent
    ? Omit<Event, 'sequence' | 'createdAt'>
    : never
  : never;

@Injectable()
export class PlaybookAssistantOperationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaybookAssistantOperationService.name);
  private readonly workerId = randomUUID();
  private recoveryTimer: NodeJS.Timeout | null = null;
  constructor(
    @InjectModel(PlaybookAssistantOperation.name)
    private readonly operationModel: Model<PlaybookAssistantOperationDocument>,
    @Optional() private readonly flowService?: PlaybookFlowService,
    @Optional() @InjectModel(PlaybookAssistantRevision.name)
    private readonly revisionModel?: Model<PlaybookAssistantRevisionDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverExpiredOperations();
    this.recoveryTimer = setInterval(() => void this.recoverExpiredOperations(), RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private async recoverExpiredOperations(): Promise<void> {
    const cutoff = new Date();
    const orphaned = await this.operationModel.find({
      status: { $in: ['queued', 'running'] },
      $or: [{ leaseExpiresAt: { $lte: cutoff } }, { leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }],
    }).lean().exec();
    for (const operation of orphaned) {
      const event = {
        type: 'failed' as const,
        constructionId: operation.operationId,
        playbookId: operation.playbookId,
        message: 'Construction worker lease expired',
        recoverable: true,
        sequence: operation.lastSequence + 1,
        createdAt: new Date().toISOString(),
      };
      const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      await this.operationModel.findOneAndUpdate(
        {
          operationId: operation.operationId,
          playbookId: operation.playbookId,
          ownerId: operation.ownerId,
          lastSequence: operation.lastSequence,
          status: { $in: ['queued', 'running'] },
          $or: [{ leaseExpiresAt: { $lte: cutoff } }, { leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }],
        },
        {
          $inc: { lastSequence: 1, eventBytes },
          $push: { events: event },
          $set: { status: 'failed', terminalAt: new Date(), leaseExpiresAt: null, expiresAt: this.expiresAt() },
        },
        { new: true },
      ).lean().exec();
    }
  }

  async create(input: {
    operationId: string;
    playbookId: string;
    ownerId: string;
    baseDefinitionRevision: number;
    origin?: 'designer' | 'mcp' | 'advisor';
    target?: 'canonical' | 'advisor_preview';
    applyTarget?: 'current_playbook' | 'new_playbook';
    requestId?: string;
    operationKind?: 'construction' | 'generation';
    createdPlaybookId?: string;
  }): Promise<void> {
    await this.operationModel.create({
      ...input,
      origin: input.origin ?? 'designer',
      target: input.target ?? 'canonical',
      applyTarget: input.applyTarget ?? 'current_playbook',
      requestId: input.requestId ?? null,
      operationKind: input.operationKind ?? 'construction',
      createdPlaybookId: input.createdPlaybookId ?? null,
      disposition: 'pending',
      status: 'queued',
      lastSequence: 0,
      events: [],
      eventBytes: 0,
      workerId: this.workerId,
      leaseExpiresAt: this.leaseExpiresAt(),
      expiresAt: this.expiresAt(),
    });
    this.logger.log(`playbook_assistant_operation_created operationId=${input.operationId} playbookId=${input.playbookId} origin=${input.origin ?? 'designer'} target=${input.target ?? 'canonical'}`);
  }

  async append(
    playbookId: string,
    ownerId: string,
    operationId: string,
    event: PersistableConstructionEvent,
  ): Promise<PlaybookIntentConstructionEvent> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getOperation(playbookId, ownerId, operationId);
      if (TERMINAL_STATUSES.includes(current.status)) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation is already terminal');
      }
      let boundedEvent = event;
      let eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (eventBytes > MAX_EVENT_BYTES || (current.eventBytes ?? 0) + eventBytes > MAX_OPERATION_EVENT_BYTES) {
        boundedEvent = {
          type: 'failed', constructionId: operationId, playbookId,
          message: 'Construction event storage limit exceeded', recoverable: false,
        };
        eventBytes = Buffer.byteLength(JSON.stringify(boundedEvent), 'utf8');
      }
      const terminal = boundedEvent.type === 'completed' || boundedEvent.type === 'failed' || boundedEvent.type === 'cancelled';
      const status = this.statusForEvent(boundedEvent.type);
      const persisted = {
        ...boundedEvent,
        sequence: current.lastSequence + 1,
        createdAt: new Date().toISOString(),
      } as PlaybookIntentConstructionEvent;
      const operation = await this.operationModel.findOneAndUpdate(
        {
          operationId,
          playbookId,
          ownerId,
          lastSequence: current.lastSequence,
          status: { $nin: TERMINAL_STATUSES },
          ...(boundedEvent.type === 'cancelled' ? {} : {
            workerId: this.workerId,
            $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
          }),
        },
        {
          $inc: { lastSequence: 1, eventBytes },
          $push: { events: persisted },
          $set: {
            ...(status ? { status } : {}),
            ...(terminal ? { terminalAt: new Date() } : {}),
            leaseExpiresAt: terminal ? null : this.leaseExpiresAt(),
            expiresAt: this.expiresAt(),
          },
        },
        { new: true },
      ).lean().exec();
      if (operation) return persisted;
    }
    throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation event sequence changed concurrently');
  }

  async getStatus(playbookId: string, ownerId: string, operationId: string): Promise<{
    operationId: string;
    playbookId: string;
    baseDefinitionRevision: number;
    status: PlaybookIntentConstructionStatus;
    lastSequence: number;
    origin: 'designer' | 'mcp' | 'advisor';
    target: 'canonical' | 'advisor_preview';
    disposition: 'pending' | 'applying' | 'applied' | 'discarded' | 'reverted';
    committedRevision: number | null;
  }> {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
    return {
      operationId,
      playbookId,
      baseDefinitionRevision: operation.baseDefinitionRevision,
      status: operation.status,
      lastSequence: operation.lastSequence,
      origin: operation.origin,
      target: operation.target,
      disposition: operation.disposition ?? 'pending',
      committedRevision: operation.committedRevision ?? null,
    };
  }

  async renewWorkerLease(playbookId: string, ownerId: string, operationId: string): Promise<boolean> {
    const result = await this.operationModel.updateOne(
      {
        operationId,
        playbookId,
        ownerId,
        workerId: this.workerId,
        status: { $in: ['queued', 'running'] },
        $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
      },
      [{
        $set: {
          leaseExpiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: PLAYBOOK_ASSISTANT_WORKER_LEASE_MS } },
          expiresAt: { $dateAdd: { startDate: '$$NOW', unit: 'millisecond', amount: RETENTION_MS } },
        },
      }],
    ).exec();
    return result.modifiedCount === 1;
  }

  async *stream(playbookId: string, ownerId: string, operationId: string, afterSequence: number): AsyncGenerator<PlaybookIntentConstructionEvent> {
    let cursor = Math.max(0, afterSequence);
    while (true) {
      const operation = await this.getOperation(playbookId, ownerId, operationId);
      const events = (operation.events ?? []) as unknown as PlaybookIntentConstructionEvent[];
      for (const event of events.filter((item) => item.sequence > cursor).sort((left, right) => left.sequence - right.sequence)) {
        cursor = event.sequence;
        yield event;
      }
      if (TERMINAL_STATUSES.includes(operation.status) && cursor >= operation.lastSequence) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async cancel(playbookId: string, ownerId: string, operationId: string, reason?: string): Promise<boolean> {
    const operation = await this.operationModel.findOne({ operationId, playbookId, ownerId }).lean().exec();
    if (!operation) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant operation not found');
    if (TERMINAL_STATUSES.includes(operation.status)) return false;
    await this.append(playbookId, ownerId, operationId, {
      type: 'cancelled',
      constructionId: operationId,
      playbookId,
      reason,
    });
    return true;
  }

  async commit(playbookId: string, ownerId: string, operationId: string, dto: UpdatePlaybookFlowDto) {
    return this.commitForTarget(playbookId, ownerId, operationId, dto, 'canonical');
  }

  async applyPreview(playbookId: string, ownerId: string, operationId: string, dto: UpdatePlaybookFlowDto) {
    return this.commitForTarget(playbookId, ownerId, operationId, dto, 'advisor_preview');
  }

  async discardPreview(playbookId: string, ownerId: string, operationId: string): Promise<{ discarded: true }> {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
    if (operation.target !== 'advisor_preview' || operation.status !== 'completed') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Advisor preview is not ready to discard');
    }
    if (operation.disposition === 'applying' || operation.disposition === 'applied' || operation.disposition === 'reverted') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Applied Advisor preview cannot be discarded');
    }
    await this.operationModel.updateOne(
      { operationId, playbookId, ownerId, disposition: { $in: ['pending', 'discarded'] } },
      { $set: { disposition: 'discarded', expiresAt: this.expiresAt() } },
    ).exec();
    this.logger.log(`playbook_assistant_preview_discarded operationId=${operationId} playbookId=${playbookId}`);
    return { discarded: true };
  }

  async revert(playbookId: string, ownerId: string, operationId: string) {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
    if (operation.disposition === 'reverted') {
      return {
        reverted: true as const,
        playbookId,
        definitionRevision: operation.revertedRevision ?? operation.committedRevision ?? null,
        createdPlaybookId: operation.createdPlaybookId ?? null,
      };
    }
    if (!operation.committedRevision) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation is not revertible');
    }
    if (!this.flowService || !this.revisionModel) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Assistant operation revert is unavailable');
    }
    if (operation.createdPlaybookId) {
      const created = await this.flowService.findOneBase(operation.createdPlaybookId, ownerId);
      if (created.definitionRevision !== operation.committedRevision) {
        throw new ConflictException(ErrorCode.CONFLICT, 'The generated Playbook changed after the assistant operation was applied');
      }
      await this.flowService.remove(operation.createdPlaybookId, ownerId);
      await this.operationModel.updateOne(
        { operationId, playbookId, ownerId, disposition: { $ne: 'reverted' } },
        { $set: { disposition: 'reverted', revertedRevision: operation.committedRevision, revertedAt: new Date(), expiresAt: this.expiresAt() } },
      ).exec();
      return { reverted: true as const, playbookId, createdPlaybookId: operation.createdPlaybookId, deleted: true as const };
    }
    const snapshot = await this.revisionModel.findOne({ operationId, playbookId, ownerId }).lean().exec();
    if (!snapshot) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant operation revision snapshot not found');
    const definition = snapshot.definition as UpdatePlaybookFlowDto;
    const result = await this.flowService.update(playbookId, ownerId, {
      ...definition,
      expectedDefinitionRevision: operation.committedRevision,
      clientMutationId: `assistant-operation-revert-${operationId}`,
    }, {
      allowUnboundRequiredPorts: true,
      allowIncompleteNodeOutputBindings: true,
    });
    const updated = await this.operationModel.updateOne(
      { operationId, playbookId, ownerId, committedRevision: operation.committedRevision, disposition: { $ne: 'reverted' } },
      { $set: { disposition: 'reverted', revertedRevision: result.definitionRevision, revertedAt: new Date(), expiresAt: this.expiresAt() } },
    ).exec();
    if (updated.modifiedCount !== 1) throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation was reverted concurrently');
    this.logger.log(`playbook_assistant_operation_reverted operationId=${operationId} playbookId=${playbookId} revision=${result.definitionRevision}`);
    return result;
  }

  private async commitForTarget(
    playbookId: string,
    ownerId: string,
    operationId: string,
    dto: UpdatePlaybookFlowDto,
    target: 'canonical' | 'advisor_preview',
  ) {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
    const failureIndex = (operation.events ?? []).findIndex((event) => event.type === 'failed' && event.failureKind === 'strict_validation');
    const hasRetainedBlockedDraft = failureIndex > 0 && (operation.events ?? [])
      .slice(0, failureIndex)
      .some((event) => {
        if (event.type !== 'node_delta' && event.type !== 'edge_delta' && event.type !== 'data_binding_delta') return false;
        const suggestion = event.suggestion as { kind?: string; validationStatus?: string; changes?: unknown[] } | undefined;
        return suggestion?.kind === 'workflow_plan'
          && suggestion.validationStatus === 'blocked'
          && Array.isArray(suggestion.changes)
          && suggestion.changes.length > 0;
      });
    const isStrictValidationDraft = target === 'canonical'
      && operation.status === 'failed'
      && hasRetainedBlockedDraft;
    if (operation.target !== target || (operation.status !== 'completed' && !isStrictValidationDraft) || operation.disposition === 'discarded' || operation.disposition === 'reverted') {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation is not ready to commit');
    }
    if (dto.expectedDefinitionRevision !== operation.baseDefinitionRevision) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation revision does not match the construction base revision');
    }
    if (!this.flowService) throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Assistant operation commit is unavailable');
    if (target === 'canonical' && operation.disposition === 'applied' && operation.committedRevision) {
      return this.flowService.findOneBase(playbookId, ownerId);
    }
    if (target === 'advisor_preview' && operation.applyTarget === 'new_playbook') {
      if (operation.disposition === 'applied' && operation.createdPlaybookId) {
        return this.flowService.findOneBase(operation.createdPlaybookId, ownerId);
      }
      if (operation.disposition === 'applying') {
        return this.waitForCreatedPlaybook(playbookId, ownerId, operationId);
      }
      const claimed = await this.operationModel.findOneAndUpdate(
        { operationId, playbookId, ownerId, status: 'completed', disposition: 'pending' },
        { $set: { disposition: 'applying', expiresAt: this.expiresAt() } },
        { new: true },
      ).lean().exec();
      if (!claimed) return this.waitForCreatedPlaybook(playbookId, ownerId, operationId);
      try {
        const current = await this.flowService.findOneBase(playbookId, ownerId);
        if (current.definitionRevision !== operation.baseDefinitionRevision) {
          throw new ConflictException(ErrorCode.CONFLICT, 'The source Playbook changed after the Advisor preview was created');
        }
        const created = await this.flowService.create(ownerId, {
          name: dto.name ?? `${current.name} (Advisor copy)`,
          description: dto.description ?? current.description,
          triggerConfig: dto.triggerConfig ?? current.triggerConfig,
          settings: dto.settings ?? current.settings,
          nodes: (dto.nodes ?? current.nodes) as CreatePlaybookFlowDto['nodes'],
          controlEdges: dto.controlEdges ?? current.controlEdges,
          dataBindings: dto.dataBindings ?? current.dataBindings,
          workspaces: dto.workspaces ?? current.workspaces,
          reflectionEnabled: dto.reflectionEnabled ?? current.reflectionEnabled,
          advisorScoringMode: dto.advisorScoringMode ?? current.advisorScoringMode,
          advisorAutopilotEnabled: dto.advisorAutopilotEnabled ?? current.advisorAutopilotEnabled,
          advisorAutopilotTargetScore: dto.advisorAutopilotTargetScore ?? current.advisorAutopilotTargetScore,
          advisorAutopilotMaxTurns: dto.advisorAutopilotMaxTurns ?? current.advisorAutopilotMaxTurns,
        }, { assistantOperationId: operationId });
        return this.recordGeneratedPlaybook(operationId, playbookId, ownerId, created);
      } catch (error) {
        const created = await this.flowService.findByAssistantOperationId(ownerId, operationId);
        if (created) return this.recordGeneratedPlaybook(operationId, playbookId, ownerId, created);
        await this.operationModel.updateOne(
          { operationId, playbookId, ownerId, disposition: 'applying' },
          { $set: { disposition: 'pending', expiresAt: this.expiresAt() } },
        ).exec();
        throw error;
      }
    }
    if (this.revisionModel) {
      const current = await this.flowService.findOneBase(playbookId, ownerId);
      const definition = this.toUpdateDefinition(current);
      const snapshotBytes = Buffer.byteLength(JSON.stringify(definition), 'utf8');
      if (snapshotBytes > MAX_REVISION_SNAPSHOT_BYTES) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook is too large to capture a safe assistant revert snapshot');
      }
      await this.revisionModel.updateOne(
        { operationId },
        {
          $setOnInsert: {
            operationId,
            playbookId,
            ownerId,
            definitionRevision: current.definitionRevision,
            definition,
          },
          $set: { expiresAt: this.expiresAt() },
        },
        { upsert: true },
      ).exec();
    }
    const result = await this.flowService.update(playbookId, ownerId, {
      ...dto,
      expectedDefinitionRevision: operation.baseDefinitionRevision,
      clientMutationId: `assistant-operation-${operationId}`,
    });
    await this.operationModel.updateOne(
      { operationId, playbookId, ownerId, status: isStrictValidationDraft ? 'failed' : 'completed' },
      { $set: { disposition: 'applied', committedRevision: result.definitionRevision, committedAt: new Date(), expiresAt: this.expiresAt() } },
    ).exec();
    this.logger.log(`playbook_assistant_operation_committed operationId=${operationId} playbookId=${playbookId} target=${target} revision=${result.definitionRevision}`);
    return result;
  }

  private toUpdateDefinition(flow: Awaited<ReturnType<PlaybookFlowService['findOneBase']>>): Record<string, unknown> {
    return {
      name: flow.name,
      description: flow.description,
      triggerConfig: flow.triggerConfig,
      settings: flow.settings,
      nodes: flow.nodes,
      controlEdges: flow.controlEdges,
      dataBindings: flow.dataBindings,
      workspaces: flow.workspaces,
      reflectionEnabled: flow.reflectionEnabled,
      advisorScoringMode: flow.advisorScoringMode,
      advisorAutopilotEnabled: flow.advisorAutopilotEnabled,
      advisorAutopilotTargetScore: flow.advisorAutopilotTargetScore,
      advisorAutopilotMaxTurns: flow.advisorAutopilotMaxTurns,
    };
  }

  private async waitForCreatedPlaybook(playbookId: string, ownerId: string, operationId: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const operation = await this.getOperation(playbookId, ownerId, operationId);
      if (operation.disposition === 'applied' && operation.createdPlaybookId) {
        if (!this.flowService) throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Assistant operation commit is unavailable');
        return this.flowService.findOneBase(operation.createdPlaybookId, ownerId);
      }
      if (operation.disposition === 'applying' && this.flowService) {
        const created = await this.flowService.findByAssistantOperationId(ownerId, operationId);
        if (created) return this.recordGeneratedPlaybook(operationId, playbookId, ownerId, created);
      }
      if (operation.disposition !== 'applying') {
        throw new ConflictException(ErrorCode.CONFLICT, 'Advisor preview apply did not complete');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ConflictException(ErrorCode.CONFLICT, 'Advisor preview apply is still in progress');
  }

  private async recordGeneratedPlaybook(
    operationId: string,
    playbookId: string,
    ownerId: string,
    created: Awaited<ReturnType<PlaybookFlowService['create']>>,
  ) {
    const recorded = await this.operationModel.updateOne(
      { operationId, playbookId, ownerId, status: 'completed', disposition: 'applying' },
      { $set: { disposition: 'applied', committedRevision: created.definitionRevision, committedAt: new Date(), createdPlaybookId: created.id, expiresAt: this.expiresAt() } },
    ).exec();
    if (recorded.modifiedCount !== 1) {
      const operation = await this.getOperation(playbookId, ownerId, operationId);
      if (operation.disposition === 'applied' && operation.createdPlaybookId === created.id) return created;
      throw new ConflictException(ErrorCode.CONFLICT, 'Generated Playbook result could not be recorded');
    }
    this.logger.log(`playbook_assistant_operation_committed operationId=${operationId} playbookId=${playbookId} target=new_playbook revision=${created.definitionRevision}`);
    return created;
  }

  private async getOperation(playbookId: string, ownerId: string, operationId: string) {
    const operation = await this.operationModel.findOne({ operationId, playbookId, ownerId }).lean().exec();
    if (!operation) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant operation not found');
    return operation;
  }

  private statusForEvent(type: PlaybookIntentConstructionEvent['type']): PlaybookIntentConstructionStatus | null {
    if (type === 'started') return 'running';
    if (type === 'completed' || type === 'failed' || type === 'cancelled') return type;
    return null;
  }

  private expiresAt(): Date {
    return new Date(Date.now() + RETENTION_MS);
  }

  private leaseExpiresAt(): Date {
    return new Date(Date.now() + PLAYBOOK_ASSISTANT_WORKER_LEASE_MS);
  }
}
