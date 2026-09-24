import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyStream,
  WorkyStreamDocument,
} from '../schemas/worky-stream.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import { ErrorCode } from '../../exceptions/constants/error-codes';

interface RequestShape {
  user?: { id: string };
  params: {
    id?: string;
    taskId?: string;
  };
}

/**
 * Owner-or-share scope guard for `/worky/tasks/{id}/...` routes
 * (Part 4). Resolves the task's parent stream, then asserts ownership.
 *
 * This guard is task-aware; the existing `WorkyStreamAccessGuard` is
 * stream-id-only and was historically mis-keyed on `params.id` for the
 * `/worky/tasks/{id}/...` endpoints. Switching the new human-update
 * endpoint to this guard is surgical; the Part 3 task ops endpoints
 * still rely on `WorkyExecutionService.findTaskForUser`'s internal
 * owner check (defense in depth) and continue to work.
 */
@Injectable()
export class WorkyTaskStreamAccessGuard implements CanActivate {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const taskId = req.params.id ?? req.params.taskId;
    if (!userId || !taskId) throw new NotFoundException('Task not found');
    if (!Types.ObjectId.isValid(taskId)) throw new NotFoundException('Task not found');
    const task = await this.tasks.findById(taskId).select({ streamId: 1 }).lean().exec();
    if (!task) throw new NotFoundException('Task not found');
    const stream = await this.streams
      .findById(task.streamId)
      .select({ ownerUserId: 1 })
      .lean()
      .exec();
    if (!stream) throw new NotFoundException('Stream not found');
    if (stream.ownerUserId.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky task.',
      );
    }
    return true;
  }
}
