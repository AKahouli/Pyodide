import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import {
  FlowExecutionLease,
  FlowExecutionLeaseDocument,
} from '../schemas/playbook-flow-execution-lease.schema';
import { PlaybookExecutionSettingsResolverService } from './playbook-execution-settings-resolver.service';

interface LeaseAcquireResult {
  acquired: boolean;
  reason?: 'global_limit' | 'owner_limit' | 'flow_limit' | 'provider_limit' | 'model_limit';
}

interface LeaseAcquireOptions {
  providerKey?: string | null;
  modelKey?: string | null;
}

interface LeaseScope {
  key: string;
  limit: number;
  reason: NonNullable<LeaseAcquireResult['reason']>;
  type: FlowExecutionLease['scopeType'];
}

/**
 * Owns distributed execution leases so queue dispatch can enforce shared
 * capacity limits across multiple backend instances without Redis.
 */
@Injectable()
export class PlaybookFlowExecutionLeaseService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaybookFlowExecutionLeaseService.name);
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(FlowExecutionLease.name)
    private readonly leaseModel: Model<FlowExecutionLeaseDocument>,
    private readonly configService: ConfigService,
    @Optional() private readonly settingsResolver?: PlaybookExecutionSettingsResolverService,
  ) {}

  isEnabled(): boolean {
    return this.configService.get<boolean>('playbook-flow.executionLeaseEnabled', false);
  }

  /**
   * Tries to reserve one slot in each concurrency scope for the execution.
   * Unique indexes on `{scopeKey, slot}` make each individual slot claim atomic.
   */
  async acquire(
    executionId: string,
    ownerId: string,
    flowId: string,
    options: LeaseAcquireOptions = {},
  ): Promise<LeaseAcquireResult> {
    if (!this.isEnabled()) {
      return { acquired: true };
    }

    await this.cleanupExpiredLeases();
    await this.release(executionId);

    for (const scope of await this.buildScopes(ownerId, flowId, options)) {
      const claimed = await this.claimScopeSlot(executionId, ownerId, flowId, scope);
      if (claimed) {
        continue;
      }

      await this.release(executionId);
      return { acquired: false, reason: scope.reason };
    }

    this.logger.log(`Acquired execution lease for ${executionId}`);
    return { acquired: true };
  }

  async refresh(executionId: string): Promise<void> {
    if (!this.isEnabled()) return;
    await this.leaseModel
      .updateMany({ executionId }, { expiresAt: this.buildExpiryDate() })
      .exec();
  }

  async hasActiveLease(executionId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const count = await this.leaseModel.countDocuments({
      executionId,
      expiresAt: { $gt: new Date() },
    });
    return count > 0;
  }

  async release(executionId: string): Promise<void> {
    this.stopHeartbeat(executionId);
    if (!this.isEnabled()) return;
    await this.leaseModel.deleteMany({ executionId }).exec();
  }

  startHeartbeat(executionId: string): void {
    if (!this.isEnabled()) return;
    this.stopHeartbeat(executionId);

    const intervalMs = this.configService.get<number>('playbook-flow.executionLeaseHeartbeatMs', 30_000);
    const timer = setInterval(() => {
      void this.refresh(executionId).catch((err) => {
        this.logger.error(
          `Failed to refresh execution lease for ${executionId}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, intervalMs);
    timer.unref?.();
    this.heartbeatTimers.set(executionId, timer);
  }

  async cleanupExpiredLeases(): Promise<void> {
    if (!this.isEnabled()) return;
    await this.leaseModel.deleteMany({ expiresAt: { $lte: new Date() } }).exec();
  }

  onModuleDestroy(): void {
    for (const executionId of this.heartbeatTimers.keys()) {
      this.stopHeartbeat(executionId);
    }
  }

  private async buildScopes(ownerId: string, flowId: string, options: LeaseAcquireOptions): Promise<LeaseScope[]> {
    const effective = this.settingsResolver ? await this.settingsResolver.resolve() : null;
    const scopes: LeaseScope[] = [
      {
        key: 'execution:global',
        limit: effective?.availableCapacity ?? this.configService.get<number>('playbook-flow.maxConcurrentGlobalExecutions', 50),
        reason: 'global_limit',
        type: 'global',
      },
      {
        key: `execution:owner:${ownerId}`,
        limit: effective?.maxConcurrentPerUser ?? this.configService.get<number>('playbook-flow.maxConcurrentPerUser', 10),
        reason: 'owner_limit',
        type: 'owner',
      },
      {
        key: `execution:flow:${flowId}`,
        limit: effective?.maxConcurrentPerFlow ?? this.configService.get<number>('playbook-flow.maxConcurrentPerFlow', 5),
        reason: 'flow_limit',
        type: 'flow',
      },
    ];

    if (options.providerKey) {
      scopes.push({
        key: `execution:provider:${options.providerKey}`,
        limit: effective?.maxConcurrentPerProvider ?? this.configService.get<number>('playbook-flow.maxConcurrentPerProvider', 25),
        reason: 'provider_limit',
        type: 'provider' as FlowExecutionLease['scopeType'],
      });
    }

    if (options.modelKey) {
      scopes.push({
        key: `execution:model:${options.modelKey}`,
        limit: effective?.maxConcurrentPerModel ?? this.configService.get<number>('playbook-flow.maxConcurrentPerModel', 10),
        reason: 'model_limit',
        type: 'model' as FlowExecutionLease['scopeType'],
      });
    }

    return scopes;
  }

  private async claimScopeSlot(
    executionId: string,
    ownerId: string,
    flowId: string,
    scope: LeaseScope,
  ): Promise<boolean> {
    for (let slot = 0; slot < scope.limit; slot += 1) {
      try {
        await this.leaseModel.create({
          executionId,
          ownerId,
          flowId,
          scopeType: scope.type,
          scopeKey: scope.key,
          slot,
          expiresAt: this.buildExpiryDate(),
        });
        return true;
      } catch (err) {
        if (!this.isDuplicateKeyError(err)) {
          throw err;
        }
      }
    }
    return false;
  }

  private buildExpiryDate(): Date {
    const ttlMs = this.configService.get<number>('playbook-flow.executionLeaseTtlMs', 120_000);
    return new Date(Date.now() + ttlMs);
  }

  private stopHeartbeat(executionId: string): void {
    const timer = this.heartbeatTimers.get(executionId);
    if (!timer) return;
    clearInterval(timer);
    this.heartbeatTimers.delete(executionId);
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 11000;
  }
}
