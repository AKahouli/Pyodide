import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type DrainQueue = (ownerId: string) => Promise<void>;

/**
 * Schedules bounded execution queue drain attempts per owner.
 *
 * The execution service still owns admission and dispatch decisions; this
 * service owns only timer lifecycle so queue orchestration does not leak
 * process-local timers across retries, shutdown, or tests.
 */
@Injectable()
export class PlaybookExecutionDispatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaybookExecutionDispatcherService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly configService: ConfigService) {}

  schedule(ownerId: string, drainQueue: DrainQueue): void {
    if (this.timers.has(ownerId)) return;

    const intervalMs = this.configService.get<number>(
      'playbook-flow.executionDispatchIntervalMs',
      1_000,
    );
    const timer = setTimeout(() => {
      this.timers.delete(ownerId);
      drainQueue(ownerId).catch((err) => {
        this.logger.error(
          `Queue dispatcher failed for owner ${ownerId}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, intervalMs);

    timer.unref?.();
    this.timers.set(ownerId, timer);
  }

  cancel(ownerId: string): void {
    const timer = this.timers.get(ownerId);
    if (!timer) return;

    clearTimeout(timer);
    this.timers.delete(ownerId);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
