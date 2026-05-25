import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowTaskResult, FlowTaskResultDocument } from '../schemas/playbook-flow-task-result.schema';

@Injectable()
export class PlaybookFlowResultsService {
  constructor(
    @InjectModel(FlowTaskResult.name)
    private readonly taskResultModel: Model<FlowTaskResultDocument>,
  ) {}

  async upsertResult(
    executionId: string,
    taskId: string,
    iteration: number,
    update: { status?: string; output?: unknown; error?: string; startedAt?: Date; endedAt?: Date },
  ): Promise<FlowTaskResultDocument> {
    return this.taskResultModel
      .findOneAndUpdate(
        { executionId, taskId, iteration },
        { $set: update },
        { upsert: true, new: true },
      )
      .exec() as Promise<FlowTaskResultDocument>;
  }

  async getResults(executionId: string): Promise<FlowTaskResultDocument[]> {
    return this.taskResultModel
      .find({ executionId })
      .sort({ taskId: 1, iteration: 1 })
      .exec();
  }

  async getResultsForTask(executionId: string, taskId: string): Promise<FlowTaskResultDocument[]> {
    return this.taskResultModel
      .find({ executionId, taskId })
      .sort({ iteration: 1 })
      .exec();
  }
}
