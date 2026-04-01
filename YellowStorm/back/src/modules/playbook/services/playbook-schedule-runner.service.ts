import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  ExecutionStatus,
} from '../schemas/playbook-execution.schema';
import type { PlaybookScheduleConcurrencyPolicy } from '../config/playbook.config';
import { PlaybookExecutionService } from './playbook-execution.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { LoggerService } from '../../logger';
import { isExecutionScheduleDueThisMinute } from '../utils/playbook-schedule.util';

/**
 * Periodically runs playbooks whose embedded `executionSchedule` is due (once per minute).
 *
 * **Concurrency when a playbook already has RUNNING / INTERRUPTED execution** — controlled by
 * `playbook.scheduleConcurrencyPolicy` (`PLAYBOOK_SCHEDULE_CONCURRENCY_POLICY`):
 * - **skip** (default): do not start another run; info log.
 * - **report**: same as skip for execution; **warn** log so missed ticks stand out in monitoring.
 * - **queue**: start the scheduled run anyway (parallel executions; only if workflows tolerate overlap).
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
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookScheduleRunner');
  }

  private get concurrencyPolicy(): PlaybookScheduleConcurrencyPolicy {
    return this.configService.get<PlaybookScheduleConcurrencyPolicy>(
      'playbook.scheduleConcurrencyPolicy',
      'skip',
    );
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
      .cursor();

    for await (const doc of cursor) {
      const schedule = doc.executionSchedule as Parameters<typeof isExecutionScheduleDueThisMinute>[0];
      if (!isExecutionScheduleDueThisMinute(schedule, now)) {
        continue;
      }

      const playbookId = (doc._id as Types.ObjectId).toString();
      const userId = (doc.createdBy as Types.ObjectId).toString();

      try {
        const active = await this.executionModel
          .findOne({
            playbookId: new Types.ObjectId(playbookId),
            status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
          })
          .select('_id')
          .lean()
          .exec();

        const policy = this.concurrencyPolicy;
        if (active && policy !== 'queue') {
          const activeExecutionId = (active._id as Types.ObjectId).toString();
          if (policy === 'report') {
            this.logger.warn('Scheduled run missed: playbook already has active execution (policy=report)', {
              playbookId,
              activeExecutionId,
            });
          } else {
            this.logger.log('Scheduled run skipped: playbook already has active execution (policy=skip)', {
              playbookId,
              activeExecutionId,
            });
          }
          continue;
        }

        if (active && policy === 'queue') {
          this.logger.warn('Scheduled run starting while playbook has active execution (policy=queue)', {
            playbookId,
            activeExecutionId: (active._id as Types.ObjectId).toString(),
          });
        }

        await this.executionService.executePlaybook(userId, playbookId, {}, '', {
          executionTrigger: 'scheduled',
        });

        await this.playbookModel.updateOne(
          { _id: doc._id },
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
