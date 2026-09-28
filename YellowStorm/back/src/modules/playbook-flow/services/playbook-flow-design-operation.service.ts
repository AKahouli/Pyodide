import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { isForeignKeyViolation } from '@common/postgres';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SystemService } from '@modules/system/system.service';
import {
  PlaybookDesignOperationRepository,
  type PlaybookDesignOperationRecord,
} from '../persistence/design-operation.repository';
import { PlaybookFlowDesignService } from './playbook-flow-design.service';
import { PlaybookFlowService } from './playbook-flow.service';

/**
 * Persists and drains asynchronous design operations while preserving a single
 * writer per flow, so concurrent AI edits cannot apply over each other.
 */
@Injectable()
export class PlaybookFlowDesignOperationService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookFlowDesignOperationService.name);
  private dispatchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly operations: PlaybookDesignOperationRepository,
    private readonly systemService: SystemService,
    private readonly flowService: PlaybookFlowService,
    private readonly designService: PlaybookFlowDesignService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (await this.isEnabled()) {
      this.scheduleDrain();
    }
  }

  async isEnabled(): Promise<boolean> {
    return (await this.systemService.getPlaybookSettings()).playbookExecution.asyncDesignEnabled;
  }

  async enqueue(userId: string, flowId: string, query: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    if (!(await this.isEnabled())) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Asynchronous design operations are disabled');
    }
    if (!query.trim()) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Design query is required');
    }

    const flow = await this.flowService.findById(flowId);
    if (String(flow.ownerId) !== String(userId)) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook flow not found');
    }

    let operation: PlaybookDesignOperationRecord;
    try {
      operation = await this.operations.enqueue({
        ownerId: userId,
        flowId,
        query: query.trim(),
        idempotencyKey,
        snapshotBefore: this.captureSnapshot(flow as unknown as Record<string, unknown>),
      });
    } catch (error) {
      // The flow was deleted after it was read.
      if (isForeignKeyViolation(error)) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook flow not found');
      throw error;
    }

    this.scheduleDrain();
    return this.mapOperation(operation);
  }

  async findOne(userId: string, flowId: string, operationId: string): Promise<Record<string, unknown>> {
    const operation = await this.operations.findForOwner(operationId, userId, flowId);
    if (!operation) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Design operation not found');
    }
    return this.mapOperation(operation);
  }

  async cancel(userId: string, flowId: string, operationId: string): Promise<Record<string, unknown>> {
    const operation = await this.operations.cancelQueued(operationId, userId, flowId);
    if (!operation) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only queued design operations can be cancelled');
    }
    return this.mapOperation(operation);
  }

  private scheduleDrain(): void {
    if (this.dispatchTimer) return;
    void this.isEnabled().then((enabled) => {
      if (!enabled || this.dispatchTimer) return;
      this.dispatchTimer = setTimeout(() => {
        this.dispatchTimer = null;
        this.drain().catch((err) => {
          this.logger.error('Design operation drain failed', err instanceof Error ? err.stack : undefined);
        });
      }, 250);
      this.dispatchTimer.unref?.();
    });
  }

  private async drain(): Promise<void> {
    while (await this.hasCapacity()) {
      const next = await this.claimNext();
      if (!next) return;
      void this.runOperation(next.id).finally(() => this.scheduleDrain());
    }
  }

  private async hasCapacity(): Promise<boolean> {
    const { playbookExecution } = await this.systemService.getPlaybookSettings();
    const activeGlobal = await this.operations.countActive();
    return activeGlobal < playbookExecution.maxConcurrentGlobalDesignOperations;
  }

  private async claimNext(): Promise<PlaybookDesignOperationRecord | null> {
    const userLimit = (await this.systemService.getPlaybookSettings()).playbookExecution.maxConcurrentUserDesignOperations;
    return this.operations.claimNext(userLimit);
  }

  private async runOperation(operationId: string): Promise<void> {
    const operation = await this.operations.findById(operationId);
    if (!operation || operation.status !== 'running') return;

    try {
      await this.operations.markApplying(operation.id, operation.lockVersion);
      const result = await this.designService.designFlow(
        operation.ownerId,
        operation.flowId,
        operation.query,
      );
      await this.operations.finish(operation.id, operation.lockVersion, {
        status: 'completed',
        resultPreview: { flowId: result.flow?.id ?? operation.flowId },
        appliedMessageId: result.message?.id ?? null,
      });
    } catch (err) {
      await this.operations.finish(operation.id, operation.lockVersion, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private captureSnapshot(flow: Record<string, unknown>): Record<string, unknown> {
    return {
      nodes: flow.nodes ?? [],
      controlEdges: flow.controlEdges ?? [],
      dataBindings: flow.dataBindings ?? [],
      updatedAt: flow.updatedAt ?? null,
    };
  }

  private mapOperation(operation: PlaybookDesignOperationRecord): Record<string, unknown> {
    return {
      id: operation.id,
      flowId: operation.flowId,
      ownerId: operation.ownerId,
      query: operation.query,
      status: operation.status,
      error: operation.error,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      resultPreview: operation.resultPreview,
      appliedMessageId: operation.appliedMessageId,
      lockVersion: operation.lockVersion,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    };
  }
}
