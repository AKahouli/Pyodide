import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { FlowRepository } from '../persistence/flow.repository';
import { ExecutionRepository } from '../persistence/execution.repository';
import {
  isFlowScheduleDueThisMinute,
  type FlowScheduleEvalInput,
} from '../utils/playbook-flow-schedule.util';

@Injectable()
export class PlaybookFlowScheduleService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly executions: ExecutionRepository,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowScheduleService'); }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDueSchedules(): Promise<void> {
    const now = new Date();
    const flows = await this.flows.listByTrigger('schedule');

    for (const flow of flows) {
      const schedule = (flow.triggerConfig?.params ?? {}) as FlowScheduleEvalInput;
      if (!isFlowScheduleDueThisMinute(schedule, now)) continue;

      const flowId = flow.id;
      if (await this.executions.hasActiveForFlow(flowId)) {
        this.logger.debug('Scheduled run skipped: flow has active execution', { flowId });
        continue;
      }

      const idempotencyKey = `schedule:${flowId}:${now.toISOString().slice(0, 16)}`;

      try {
        await this.executionService.start(flowId, flow.ownerId, undefined, idempotencyKey);
        await this.flows.setTriggerParam(flowId, 'lastScheduledRunAt', now);
        this.logger.log('Scheduled flow run started', { flowId });
      } catch (err) {
        this.logger.warn('Scheduled flow run failed', { flowId, error: (err as Error).message });
      }
    }
  }
}
