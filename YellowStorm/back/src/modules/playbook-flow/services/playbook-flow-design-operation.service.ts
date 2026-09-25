import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SystemService } from '@modules/system/system.service';
import {
  FlowDesignOperation,
  FlowDesignOperationDocument,
} from '../schemas/playbook-flow-design-operation.schema';
import { PlaybookFlowDesignService } from './playbook-flow-design.service';
import { PlaybookFlowService } from './playbook-flow.service';

const ACTIVE_DESIGN_STATUSES = ['running', 'applying'] as const;

/**
 * Persists and drains asynchronous design operations while preserving a single
 * writer per flow, so concurrent AI edits cannot apply over each other.
 */
@Injectable()
export class PlaybookFlowDesignOperationService implements OnModuleInit {
  private readonly logger = new Logger(PlaybookFlowDesignOperationService.name);
  private dispatchTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(FlowDesignOperation.name)
    private readonly operationModel: Model<FlowDesignOperationDocument>,
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

    const operation = await this.operationModel.findOneAndUpdate(
      {
        ownerId: new Types.ObjectId(userId),
        flowId: new Types.ObjectId(flowId),
        ...(idempotencyKey ? { idempotencyKey } : { _id: new Types.ObjectId() }),
      },
      {
        $setOnInsert: {
          ownerId: new Types.ObjectId(userId),
          flowId: new Types.ObjectId(flowId),
          query: query.trim(),
          status: 'queued',
          idempotencyKey,
          snapshotBefore: this.captureSnapshot(flow as unknown as Record<string, unknown>),
          lockVersion: 0,
        },
      },
      { upsert: true, new: true },
    ).exec();

    this.scheduleDrain();
    return this.mapOperation(this.toOperationRecord(operation));
  }

  async findOne(userId: string, flowId: string, operationId: string): Promise<Record<string, unknown>> {
    const operation = await this.operationModel.findOne({
      _id: operationId,
      ownerId: new Types.ObjectId(userId),
      flowId: new Types.ObjectId(flowId),
    }).lean().exec();
    if (!operation) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'Design operation not found');
    }
    return this.mapOperation(this.toOperationRecord(operation));
  }

  async cancel(userId: string, flowId: string, operationId: string): Promise<Record<string, unknown>> {
    const operation = await this.operationModel.findOneAndUpdate(
      {
        _id: operationId,
        ownerId: new Types.ObjectId(userId),
        flowId: new Types.ObjectId(flowId),
        status: 'queued',
      },
      { status: 'cancelled', completedAt: new Date() },
      { new: true },
    ).exec();
    if (!operation) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only queued design operations can be cancelled');
    }
    return this.mapOperation(this.toOperationRecord(operation));
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
    const activeGlobal = await this.operationModel.countDocuments({ status: { $in: ACTIVE_DESIGN_STATUSES } });
    return activeGlobal < playbookExecution.maxConcurrentGlobalDesignOperations;
  }

  private async claimNext(): Promise<FlowDesignOperationDocument | null> {
    const queued = await this.operationModel.find({ status: 'queued' }).sort({ createdAt: 1 }).limit(20).exec();

    const userLimit = (await this.systemService.getPlaybookSettings()).playbookExecution.maxConcurrentUserDesignOperations;
    for (const next of queued) {
      const activeForUser = await this.operationModel.countDocuments({
        ownerId: next.ownerId,
        status: { $in: ACTIVE_DESIGN_STATUSES },
      });
      const activeForFlow = await this.operationModel.countDocuments({
        flowId: next.flowId,
        status: { $in: ACTIVE_DESIGN_STATUSES },
      });
      if (activeForUser >= userLimit || activeForFlow > 0) {
        continue;
      }

      const claimed = await this.operationModel.findOneAndUpdate(
        { _id: next.id, status: 'queued' },
        { status: 'running', startedAt: new Date(), $inc: { lockVersion: 1 } },
        { new: true },
      ).exec();
      if (claimed) return claimed;
    }

    return null;
  }

  private async runOperation(operationId: string): Promise<void> {
    const operation = await this.operationModel.findById(operationId).exec();
    if (!operation || operation.status !== 'running') return;

    try {
      await this.operationModel.updateOne({ _id: operation.id }, { status: 'applying' }).exec();
      const result = await this.designService.designFlow(
        operation.ownerId.toString(),
        operation.flowId.toString(),
        operation.query,
      );
      await this.operationModel.updateOne(
        { _id: operation.id },
        {
          status: 'completed',
          completedAt: new Date(),
          resultPreview: { flowId: result.flow?.id ?? operation.flowId.toString() },
          appliedMessageId: result.message?.id ? new Types.ObjectId(result.message.id) : null,
        },
      ).exec();
    } catch (err) {
      await this.operationModel.updateOne(
        { _id: operation.id },
        {
          status: 'failed',
          completedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        },
      ).exec();
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

  private toOperationRecord(operation: unknown): Record<string, unknown> {
    const candidate = operation as { toObject?: () => Record<string, unknown> };
    return typeof candidate.toObject === 'function'
      ? candidate.toObject()
      : (operation as Record<string, unknown>);
  }

  private mapOperation(operation: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(operation._id ?? operation.id),
      flowId: operation.flowId?.toString?.() ?? operation.flowId,
      ownerId: operation.ownerId?.toString?.() ?? operation.ownerId,
      query: operation.query,
      status: operation.status,
      error: operation.error ?? null,
      startedAt: operation.startedAt ?? null,
      completedAt: operation.completedAt ?? null,
      resultPreview: operation.resultPreview ?? null,
      appliedMessageId: operation.appliedMessageId?.toString?.() ?? operation.appliedMessageId ?? null,
      lockVersion: operation.lockVersion ?? 0,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    };
  }
}
