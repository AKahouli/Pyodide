import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkyStreamService } from '../services/worky-stream.service';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { canWriteWorkyStream, getWorkyStreamAccess } from '../worky-stream-access';

interface RequestShape {
  user?: { id: string };
  params: { id?: string };
  method: string;
}

/**
 * Owner-or-share scope guard for any `/worky/streams/{id}/...` route.
 * Streams created in Part 1 are always owner-only (no `workspace-share` row
 * is created yet — that lands in Part 3 when humans are added to a stream).
 * A future Part 3 patch will extend the same guard with a `WorkspaceShare`
 * lookup.
 */
@Injectable()
export class WorkyStreamAccessGuard implements CanActivate {
  constructor(private readonly streams: WorkyStreamService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.id;
    const streamId = req.params.id;
    if (!userId || !streamId) throw new NotFoundException('Stream not found');
    if (!Types.ObjectId.isValid(streamId)) throw new NotFoundException('Stream not found');

    const stream = await this.streams.findByIdInternal(streamId);
    if (!stream) throw new NotFoundException('Stream not found');
    const allowed = req.method === 'GET'
      ? Boolean(getWorkyStreamAccess(stream, userId))
      : canWriteWorkyStream(stream, userId);
    if (!allowed) {
      throw new ForbiddenException(
        ErrorCode.WORKY_STREAM_FORBIDDEN,
        'You do not have access to this Worky stream.',
      );
    }
    return true;
  }
}
