import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyTaskResult,
  WorkyTaskResultDocument,
} from '../schemas/worky-task-result.schema';
import { LoggerService } from '../../logger';

export interface RecordTaskResultInput {
  taskId: string;
  status: string;
  summary?: string;
  contentArtifactId?: string | null;
  createdByWorkerId?: string | null;
}

export interface RecordTaskResultResult {
  taskResultId: string;
  taskId: string;
  version: number;
  status: string;
  replay: boolean;
}

@Injectable()
export class WorkyTaskResultService {
  constructor(
    @InjectModel(WorkyTaskResult.name)
    private readonly results: Model<WorkyTaskResultDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyTaskResultService.name);
  }

  async record(input: RecordTaskResultInput): Promise<RecordTaskResultResult> {
    if (!Types.ObjectId.isValid(input.taskId)) {
      throw new Error('WorkyTaskResultService.record: invalid taskId');
    }
    const latest = await this.results
      .findOne({ taskId: new Types.ObjectId(input.taskId) })
      .sort({ version: -1 })
      .select({ version: 1 })
      .lean()
      .exec();
    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await this.results.create({
      taskId: new Types.ObjectId(input.taskId),
      version: nextVersion,
      status: input.status,
      summary: input.summary ?? '',
      contentArtifactId:
        input.contentArtifactId && Types.ObjectId.isValid(input.contentArtifactId)
          ? new Types.ObjectId(input.contentArtifactId)
          : null,
      createdByWorkerId:
        input.createdByWorkerId && Types.ObjectId.isValid(input.createdByWorkerId)
          ? new Types.ObjectId(input.createdByWorkerId)
          : null,
    });
    this.logger.log('Worky task result recorded', {
      taskId: input.taskId,
      version: nextVersion,
      status: input.status,
    });
    return {
      taskResultId: (created._id as Types.ObjectId).toString(),
      taskId: input.taskId,
      version: nextVersion,
      status: input.status,
      replay: false,
    };
  }
}
