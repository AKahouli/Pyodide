import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { canWriteWorkyStream, getWorkyStreamAccess } from '../worky-stream-access';

interface RequestShape {
  user?: { id: string };
  params: {
    id?: string;
    taskId?: string;
  };
  method: string;
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
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const taskId = req.params.id ?? req.params.taskId;
    if (!userId || !taskId) throw new NotFoundException('Task not found');
    if (!isObjectId(taskId)) throw new NotFoundException('Task not found');
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    const stream = await this.streams.findById(task.streamId);
    if (!stream) throw new NotFoundException('Stream not found');
    const allowed = req.method === 'GET'
      ? Boolean(getWorkyStreamAccess(stream, userId))
      : canWriteWorkyStream(stream, userId);
    if (!allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky task.',
      );
    }
    return true;
  }
}
