import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { PlaybookIntentConstructionEvent, PlaybookIntentConstructionStatus } from '../interfaces/playbook-flow-intent-construction.interface';
import {
  PlaybookAssistantOperationRepository,
  type PlaybookAssistantOperationRecord,
} from '../persistence/assistant-operation.repository';
import { PlaybookAssistantRevisionRepository } from '../persistence/assistant-revision.repository';
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
    private readonly operations: PlaybookAssistantOperationRepository,
    @Optional() private readonly flowService?: PlaybookFlowService,
    @Optional() private readonly revisions?: PlaybookAssistantRevisionRepository,
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
    const orphaned = await this.operations.findOrphaned(cutoff);
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
      await this.operations.failOrphaned(
        { operationId: operation.operationId, playbookId: operation.playbookId, ownerId: operation.ownerId },
        { expectedSequence: operation.lastSequence, cutoff, event, eventBytes, expiresAt: this.expiresAt() },
      );
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
    await this.operations.insert({
      ...input,
      origin: input.origin ?? 'designer',
      target: input.target ?? 'canonical',
      applyTarget: input.applyTarget ?? 'current_playbook',
      requestId: input.requestId ?? null,
      operationKind: input.operationKind ?? 'construction',
      createdPlaybookId: input.createdPlaybookId ?? null,
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
      if (eventBytes > MAX_EVENT_BYTES || current.eventBytes + eventBytes > MAX_OPERATION_EVENT_BYTES) {
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
      };
      const appended = await this.operations.appendEvent({ operationId, playbookId, ownerId }, {
        expectedSequence: current.lastSequence,
        event: persisted,
        eventBytes,
        status,
        terminal,
        leaseExpiresAt: terminal ? null : this.leaseExpiresAt(),
        expiresAt: this.expiresAt(),
        // A cancellation is accepted from any caller; every other event only from the worker holding the lease.
        ...(boundedEvent.type === 'cancelled' ? {} : { workerId: this.workerId }),
      });
      if (appended) return persisted;
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
      disposition: operation.disposition,
      committedRevision: operation.committedRevision,
    };
  }

  async renewWorkerLease(playbookId: string, ownerId: string, operationId: string): Promise<boolean> {
    return this.operations.renewLease({ operationId, playbookId, ownerId }, this.workerId, PLAYBOOK_ASSISTANT_WORKER_LEASE_MS, RETENTION_MS);
  }

  async *stream(playbookId: string, ownerId: string, operationId: string, afterSequence: number): AsyncGenerator<PlaybookIntentConstructionEvent> {
    let cursor = Math.max(0, afterSequence);
    while (true) {
      const operation = await this.getOperation(playbookId, ownerId, operationId);
      const events = operation.events as unknown as PlaybookIntentConstructionEvent[];
      for (const event of events.filter((item) => item.sequence > cursor).sort((left, right) => left.sequence - right.sequence)) {
        cursor = event.sequence;
        yield event;
      }
      if (TERMINAL_STATUSES.includes(operation.status) && cursor >= operation.lastSequence) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async cancel(playbookId: string, ownerId: string, operationId: string, reason?: string): Promise<boolean> {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
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
    await this.operations.discard({ operationId, playbookId, ownerId }, this.expiresAt());
    this.logger.log(`playbook_assistant_preview_discarded operationId=${operationId} playbookId=${playbookId}`);
    return { discarded: true };
  }

  async revert(playbookId: string, ownerId: string, operationId: string) {
    const operation = await this.getOperation(playbookId, ownerId, operationId);
    if (operation.disposition === 'reverted') {
      return {
        reverted: true as const,
        playbookId,
        definitionRevision: operation.revertedRevision ?? operation.committedRevision,
        createdPlaybookId: operation.createdPlaybookId,
      };
    }
    if (!operation.committedRevision) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation is not revertible');
    }
    if (!this.flowService || !this.revisions) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Assistant operation revert is unavailable');
    }
    if (operation.createdPlaybookId) {
      const created = await this.flowService.findOneBase(operation.createdPlaybookId, ownerId);
      if (created.definitionRevision !== operation.committedRevision) {
        throw new ConflictException(ErrorCode.CONFLICT, 'The generated Playbook changed after the assistant operation was applied');
      }
      await this.flowService.remove(operation.createdPlaybookId, ownerId);
      await this.operations.markReverted({ operationId, playbookId, ownerId }, {
        revertedRevision: operation.committedRevision,
        expiresAt: this.expiresAt(),
      });
      return { reverted: true as const, playbookId, createdPlaybookId: operation.createdPlaybookId, deleted: true as const };
    }
    const snapshot = await this.revisions.find({ operationId, playbookId, ownerId });
    if (!snapshot) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Assistant operation revision snapshot not found');
    const definition = snapshot.definition as unknown as UpdatePlaybookFlowDto;
    const result = await this.flowService.update(playbookId, ownerId, {
      ...definition,
      expectedDefinitionRevision: operation.committedRevision,
      clientMutationId: `assistant-operation-revert-${operationId}`,
    }, {
      allowUnboundRequiredPorts: true,
      allowIncompleteNodeOutputBindings: true,
    });
    const reverted = await this.operations.markReverted({ operationId, playbookId, ownerId }, {
      revertedRevision: result.definitionRevision,
      committedRevision: operation.committedRevision,
      expiresAt: this.expiresAt(),
    });
    if (!reverted) throw new ConflictException(ErrorCode.CONFLICT, 'Assistant operation was reverted concurrently');
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
    const failureIndex = operation.events.findIndex((event) => event.type === 'failed' && event.failureKind === 'strict_validation');
    const hasRetainedBlockedDraft = failureIndex > 0 && operation.events
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
      const claimed = await this.operations.claimApply({ operationId, playbookId, ownerId }, this.expiresAt());
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
        await this.operations.releaseApply({ operationId, playbookId, ownerId }, this.expiresAt());
        throw error;
      }
    }
    if (this.revisions) {
      const current = await this.flowService.findOneBase(playbookId, ownerId);
      const definition = this.toUpdateDefinition(current);
      const snapshotBytes = Buffer.byteLength(JSON.stringify(definition), 'utf8');
      if (snapshotBytes > MAX_REVISION_SNAPSHOT_BYTES) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook is too large to capture a safe assistant revert snapshot');
      }
      await this.revisions.captureOnce({
        operationId,
        playbookId,
        ownerId,
        definitionRevision: current.definitionRevision,
        definition,
        expiresAt: this.expiresAt(),
      });
    }
    const result = await this.flowService.update(playbookId, ownerId, {
      ...dto,
      expectedDefinitionRevision: operation.baseDefinitionRevision,
      clientMutationId: `assistant-operation-${operationId}`,
    });
    await this.operations.markApplied({ operationId, playbookId, ownerId }, {
      status: isStrictValidationDraft ? 'failed' : 'completed',
      committedRevision: result.definitionRevision,
      expiresAt: this.expiresAt(),
    });
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
    const recorded = await this.operations.recordCreatedPlaybook({ operationId, playbookId, ownerId }, {
      createdPlaybookId: created.id,
      committedRevision: created.definitionRevision,
      expiresAt: this.expiresAt(),
    });
    if (!recorded) {
      const operation = await this.getOperation(playbookId, ownerId, operationId);
      if (operation.disposition === 'applied' && operation.createdPlaybookId === created.id) return created;
      throw new ConflictException(ErrorCode.CONFLICT, 'Generated Playbook result could not be recorded');
    }
    this.logger.log(`playbook_assistant_operation_committed operationId=${operationId} playbookId=${playbookId} target=new_playbook revision=${created.definitionRevision}`);
    return created;
  }

  private async getOperation(playbookId: string, ownerId: string, operationId: string): Promise<PlaybookAssistantOperationRecord> {
    const operation = await this.operations.find({ operationId, playbookId, ownerId });
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
