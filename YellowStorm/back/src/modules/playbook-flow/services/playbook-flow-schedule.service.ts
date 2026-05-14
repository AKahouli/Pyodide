import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import {
  isFlowScheduleDueThisMinute,
  type FlowScheduleEvalInput,
} from '../utils/playbook-flow-schedule.util';

@Injectable()
export class PlaybookFlowScheduleService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowScheduleService'); }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDueSchedules(): Promise<void> {
    const now = new Date();
    const flows = await this.flowModel
      .find({ 'triggerConfig.kind': 'schedule' })
      .select('ownerId triggerConfig')
      .lean()
      .exec();

    for (const flow of flows) {
      const schedule = (flow.triggerConfig?.params ?? {}) as FlowScheduleEvalInput;
      if (!isFlowScheduleDueThisMinute(schedule, now)) continue;

      const flowId = (flow as any)._id.toString();
      const active = await this.executionModel.findOne({
        flowId,
        status: { $in: ['running', 'pending_approval'] },
      }).lean();

      if (active) {
        this.logger.debug('Scheduled run skipped: flow has active execution', { flowId });
        continue;
      }

      const idempotencyKey = `schedule:${flowId}:${now.toISOString().slice(0, 16)}`;

      try {
        await this.executionService.start(flowId, flow.ownerId, undefined, idempotencyKey);
        await this.flowModel.updateOne(
          { _id: (flow as any)._id },
          { $set: { 'triggerConfig.params.lastScheduledRunAt': now } },
        );
        this.logger.log('Scheduled flow run started', { flowId });
      } catch (err) {
        this.logger.warn('Scheduled flow run failed', { flowId, error: (err as Error).message });
      }
    }
  }
}
