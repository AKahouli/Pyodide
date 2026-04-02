import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  ExecutionStatus,
} from '../schemas/playbook-execution.schema';
import { PlaybookExecutionService } from './playbook-execution.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { LoggerService } from '../../logger';
import { isExecutionScheduleDueThisMinute, type ScheduleEvalInput } from '../utils/playbook-schedule.util';

/**
 * Periodically runs playbooks whose embedded `executionSchedule` is due (once per minute).
 *
 * **Concurrency when a playbook already has RUNNING / INTERRUPTED execution** — the scheduled run is
 * skipped (info log); a second run is not started.
 *
 * gRPC must be available or the whole tick is skipped (no partial runs without the workflow engine).
 */
@Injectable()
export class PlaybookScheduleRunnerService {
  constructor(
    @InjectModel(Playbook.name) private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly executionService: PlaybookExecutionService,
    private readonly grpcService: PlaybookGrpcService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookScheduleRunner');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDueSchedules(): Promise<void> {
    if (!this.grpcService.isAvailable) {
      this.logger.debug('Schedule tick skipped: gRPC unavailable');
      return;
    }

    const now = new Date();
    const cursor = this.playbookModel
      .find({
        isActive: true,
        'executionSchedule.enabled': true,
      })
      .select('_id createdBy executionSchedule')
      .lean()
      .cursor({ noCursorTimeout: true });

    const due: Array<{ playbookId: string; userId: string; _id: Types.ObjectId; schedule: ScheduleEvalInput }> = [];
    for await (const doc of cursor) {
      const schedule = doc.executionSchedule as ScheduleEvalInput;
      if (!isExecutionScheduleDueThisMinute(schedule, now)) {
        continue;
      }
      due.push({
        _id: doc._id as Types.ObjectId,
        playbookId: (doc._id as Types.ObjectId).toString(),
        userId: (doc.createdBy as Types.ObjectId).toString(),
        schedule,
      });
    }

    if (due.length === 0) return;

    const activeExecs = await this.executionModel
      .find({
        playbookId: { $in: due.map((d) => d._id) },
        status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
      })
      .select('playbookId _id')
      .lean()
      .exec();

    const activePlaybookIds = new Set(
      activeExecs.map((e) => (e.playbookId as Types.ObjectId).toString()),
    );

    for (const { playbookId, userId, _id } of due) {
      if (activePlaybookIds.has(playbookId)) {
        this.logger.log('Scheduled run skipped: playbook already has active execution', {
          playbookId,
        });
        continue;
      }

      try {
        await this.executionService.executePlaybook(userId, playbookId, {}, '', {
          executionTrigger: 'scheduled',
        });

        await this.playbookModel.updateOne(
          { _id },
          { $set: { 'executionSchedule.lastScheduledRunAt': now } },
        );

        this.logger.log('Scheduled playbook run started', { playbookId, userId });
      } catch (err) {
        this.logger.warn('Scheduled playbook run failed', {
          playbookId,
          error: (err as Error).message,
        });
      }
    }
  }
}
