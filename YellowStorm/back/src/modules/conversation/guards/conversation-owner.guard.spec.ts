import { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { ForbiddenException } from '../../exceptions';
import { ConversationOwnerGuard } from './conversation-owner.guard';

describe('ConversationOwnerGuard', () => {
  it('denies active stream snapshots to invited non-members', async () => {
    const userId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const exec = jest.fn().mockResolvedValue({
      createdBy: new Types.ObjectId(),
      groupMeta: {
        members: [],
        invitedUsers: [{ email: 'invitee@example.com' }],
      },
    });
    const conversationModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec }),
      }),
    };
    const guard = new ConversationOwnerGuard(conversationModel as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: userId, email: 'invitee@example.com' },
          params: { id: conversationId.toString() },
          method: 'GET',
          url: `/conversations/${conversationId}/active-stream`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
