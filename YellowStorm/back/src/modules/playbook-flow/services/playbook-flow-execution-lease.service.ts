import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemService } from '@modules/system/system.service';
import { ExecutionLeaseRepository, type ExecutionLeaseScopeType } from '../persistence/execution-lease.repository';
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
  type: ExecutionLeaseScopeType;
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
    private readonly leaseRepository: ExecutionLeaseRepository,
    private readonly configService: ConfigService,
    private readonly systemService: SystemService,
    @Optional() private readonly settingsResolver?: PlaybookExecutionSettingsResolverService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.systemService.getPlaybookSettings()).playbookExecution.executionLeaseEnabled;
  }

  /**
   * Tries to reserve one slot in each concurrency scope for the execution.
   * The unique index on `(scope_key, slot)` makes each individual slot claim atomic.
   */
  async acquire(
    executionId: string,
    ownerId: string,
    flowId: string,
    options: LeaseAcquireOptions = {},
  ): Promise<LeaseAcquireResult> {
    if (!(await this.isEnabled())) {
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
    if (!(await this.isEnabled())) return;
    await this.leaseRepository.refresh(executionId, this.buildExpiryDate());
  }

  async hasActiveLease(executionId: string): Promise<boolean> {
    if (!(await this.isEnabled())) {
      return false;
    }

    return this.leaseRepository.hasActive(executionId);
  }

  async release(executionId: string): Promise<void> {
    this.stopHeartbeat(executionId);
    if (!(await this.isEnabled())) return;
    await this.leaseRepository.releaseExecution(executionId);
  }

  startHeartbeat(executionId: string): void {
    void this.isEnabled().then((enabled) => {
      if (!enabled) return;
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
    });
  }

  async cleanupExpiredLeases(): Promise<void> {
    if (!(await this.isEnabled())) return;
    await this.leaseRepository.deleteExpired();
  }

  onModuleDestroy(): void {
    for (const executionId of this.heartbeatTimers.keys()) {
      this.stopHeartbeat(executionId);
    }
  }

  private async buildScopes(ownerId: string, flowId: string, options: LeaseAcquireOptions): Promise<LeaseScope[]> {
    // Resolver (when present) applies per-execution overrides; otherwise the
    // stored admin settings are the effective values.
    const effective = this.settingsResolver
      ? await this.settingsResolver.resolve()
      : (await this.systemService.getPlaybookSettings()).playbookExecution;
    const scopes: LeaseScope[] = [
      {
        key: 'execution:global',
        limit: effective.availableCapacity,
        reason: 'global_limit',
        type: 'global',
      },
      {
        key: `execution:owner:${ownerId}`,
        limit: effective.maxConcurrentPerUser,
        reason: 'owner_limit',
        type: 'owner',
      },
      {
        key: `execution:flow:${flowId}`,
        limit: effective.maxConcurrentPerFlow,
        reason: 'flow_limit',
        type: 'flow',
      },
    ];

    if (options.providerKey) {
      scopes.push({
        key: `execution:provider:${options.providerKey}`,
        limit: effective.maxConcurrentPerProvider,
        reason: 'provider_limit',
        type: 'provider',
      });
    }

    if (options.modelKey) {
      scopes.push({
        key: `execution:model:${options.modelKey}`,
        limit: effective.maxConcurrentPerModel,
        reason: 'model_limit',
        type: 'model',
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
    // A slot held by a live lease is refused; one whose lease expired is taken over.
    for (let slot = 0; slot < scope.limit; slot += 1) {
      const claimed = await this.leaseRepository.claimSlot({
        executionId,
        ownerId,
        flowId,
        scopeType: scope.type,
        scopeKey: scope.key,
        slot,
        expiresAt: this.buildExpiryDate(),
      });
      if (claimed) return true;
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
}
