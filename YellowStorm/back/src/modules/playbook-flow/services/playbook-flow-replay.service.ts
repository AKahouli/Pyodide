import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionDocument } from '../schemas/playbook-flow-router-decision.schema';
import {
  FlowValidatedReplay,
  FlowValidatedReplayDocument,
  FlowReplayValidationStatus,
} from '../schemas/playbook-flow-validated-replay.schema';

export interface TraceReplayEvent {
  type: 'NodeStarted' | 'NodeCompleted' | 'NodeFailed' | 'RouterDecision' | 'ApprovalRequested' | 'ExecutionCompleted' | 'ExecutionFailed';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ValidateTaskReplayDto {
  preserveOutputFormat?: boolean;
}

export interface UpdateReplayFormatGuideDto {
  preserveOutputFormat?: boolean;
  outputFormatGuide?: string;
}

@Injectable()
export class PlaybookFlowReplayService {
  constructor(
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    @InjectModel(FlowTaskResult.name) private readonly taskResultModel: Model<FlowTaskResultDocument>,
    @InjectModel(FlowRouterDecision.name) private readonly routerDecisionModel: Model<FlowRouterDecisionDocument>,
    @InjectModel(FlowValidatedReplay.name) private readonly replayModel: Model<FlowValidatedReplayDocument>,
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowReplayService'); }

  async traceReplay(executionId: string, userId: string): Promise<TraceReplayEvent[]> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).lean();
    if (!execution) throw new NotFoundException('Execution not found');

    const [taskResults, routerDecisions] = await Promise.all([
      this.taskResultModel.find({ executionId }).sort({ endedAt: 1 }).lean(),
      this.routerDecisionModel.find({ executionId }).sort({ decidedAt: 1 }).lean(),
    ]);

    const events: TraceReplayEvent[] = [];

    for (const tr of taskResults) {
      const ts = tr.startedAt?.toISOString() ?? (tr as any).createdAt?.toISOString() ?? '';
      const te = tr.endedAt?.toISOString() ?? ts;

      events.push({
        type: 'NodeStarted',
        timestamp: ts,
        data: { taskId: tr.taskId, iteration: tr.iteration },
      });

      if (tr.status === 'completed') {
        events.push({
          type: 'NodeCompleted',
          timestamp: te,
          data: { taskId: tr.taskId, iteration: tr.iteration, output: tr.output },
        });
      } else if (tr.status === 'failed') {
        events.push({
          type: 'NodeFailed',
          timestamp: te,
          data: { taskId: tr.taskId, iteration: tr.iteration, error: tr.error },
        });
      }
    }

    for (const rd of routerDecisions) {
      events.push({
        type: 'RouterDecision',
        timestamp: rd.decidedAt?.toISOString() ?? (rd as any).createdAt?.toISOString() ?? '',
        data: { routerNodeId: rd.routerNodeId, iteration: rd.iteration, label: rd.label },
      });
    }

    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const finalEvent: TraceReplayEvent = {
      type: execution.status === 'completed' ? 'ExecutionCompleted' : 'ExecutionFailed',
      timestamp: execution.endedAt?.toISOString() ?? new Date().toISOString(),
      data: { status: execution.status, error: execution.error },
    };
    events.push(finalEvent);

    return events;
  }

  async reExecute(executionId: string, userId: string): Promise<{ executionId: string; divergenceWarning: boolean }> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).lean();
    if (!execution) throw new NotFoundException('Execution not found');

    const result = await this.executionService.start(
      execution.flowId,
      userId,
      execution.inputContext as Record<string, unknown> | undefined,
    );

    return { executionId: result.id, divergenceWarning: true };
  }

  async validateTaskReplay(
    userId: string,
    flowId: string,
    taskId: string,
    iteration: number,
    executionId: string,
    dto?: ValidateTaskReplayDto,
  ): Promise<FlowValidatedReplayDocument> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId: userId }).lean();
    if (!execution) throw new NotFoundException('Execution not found');

    const taskResult = await this.taskResultModel.findOne({ executionId, taskId, iteration }).lean();
    if (!taskResult) throw new NotFoundException('Task result not found');

    const lastReplay = await this.replayModel
      .findOne({ flowId, taskId, status: FlowReplayValidationStatus.ACTIVE })
      .sort({ validationVersion: -1 })
      .lean();

    const newVersion = (lastReplay?.validationVersion ?? 0) + 1;

    const [replay] = await this.replayModel.create([{
      flowId,
      taskId,
      iteration,
      taskTitle: taskId,
      createdBy: userId,
      referenceExecutionId: executionId,
      referenceExecutionNumber: 1,
      validationVersion: newVersion,
      status: FlowReplayValidationStatus.ACTIVE,
      referenceOutput: typeof taskResult.output === 'string' ? taskResult.output : JSON.stringify(taskResult.output ?? ''),
      preserveOutputFormat: dto?.preserveOutputFormat ?? false,
    }]);

    if (lastReplay) {
      await this.replayModel.updateOne(
        { _id: lastReplay._id },
        { status: FlowReplayValidationStatus.INACTIVE },
      );
    }

    return replay;
  }

  async listTaskReplays(flowId: string, taskId: string): Promise<FlowValidatedReplayDocument[]> {
    return this.replayModel.find({ flowId, taskId }).sort({ validationVersion: -1 }).exec();
  }

  async activateTaskReplay(flowId: string, taskId: string, replayId: string): Promise<FlowValidatedReplayDocument> {
    await this.replayModel.updateMany(
      { flowId, taskId, status: FlowReplayValidationStatus.ACTIVE },
      { status: FlowReplayValidationStatus.INACTIVE },
    );

    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      { status: FlowReplayValidationStatus.ACTIVE },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async updateTaskReplayFormatGuide(
    flowId: string,
    taskId: string,
    replayId: string,
    dto: UpdateReplayFormatGuideDto,
  ): Promise<FlowValidatedReplayDocument> {
    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      { $set: { outputFormatGuide: dto.outputFormatGuide, preserveOutputFormat: dto.preserveOutputFormat } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async updateTaskReplayLabel(
    flowId: string,
    taskId: string,
    replayId: string,
    label: string,
  ): Promise<FlowValidatedReplayDocument> {
    const updated = await this.replayModel.findOneAndUpdate(
      { _id: replayId, flowId, taskId },
      { $set: { label } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Replay not found');
    return updated;
  }

  async deleteTaskReplay(flowId: string, taskId: string, replayId: string): Promise<void> {
    const result = await this.replayModel.deleteOne({ _id: replayId, flowId, taskId });
    if (result.deletedCount === 0) throw new NotFoundException('Replay not found');
  }

  async getActiveReplay(flowId: string, taskId: string): Promise<FlowValidatedReplayDocument | null> {
    return this.replayModel.findOne({ flowId, taskId, status: FlowReplayValidationStatus.ACTIVE }).exec();
  }

  async getActiveReplays(flowId: string, taskIds: string[]): Promise<FlowValidatedReplayDocument[]> {
    return this.replayModel.find({
      flowId,
      taskId: { $in: taskIds },
      status: FlowReplayValidationStatus.ACTIVE,
    }).exec();
  }
}
