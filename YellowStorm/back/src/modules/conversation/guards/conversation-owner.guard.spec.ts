import { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ConversationOwnerGuard } from './conversation-owner.guard';

describe('ConversationOwnerGuard', () => {
  it('allows the creator through the neutral access record', async () => {
    const userId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId,
        createdBy: userId,
        memberIds: [],
        invitedEmails: [],
      }),
    };
    const guard = new ConversationOwnerGuard(conversationStore as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: userId, email: 'owner@example.com' },
          params: { id: conversationId },
          method: 'GET',
          url: `/conversations/${conversationId}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(conversationStore.findActiveAccessById).toHaveBeenCalledWith(conversationId);
  });

  it('rejects non-canonical IDs before querying the store', async () => {
    const conversationStore = { findActiveAccessById: jest.fn() };
    const guard = new ConversationOwnerGuard(conversationStore as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: new Types.ObjectId(), email: 'owner@example.com' },
          params: { id: 'ABCDEFABCDEFABCDEFABCDEF' },
          method: 'GET',
          url: '/conversations/invalid',
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(conversationStore.findActiveAccessById).not.toHaveBeenCalled();
  });

  it('denies active stream snapshots to invited non-members', async () => {
    const userId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId.toString(),
        createdBy: new Types.ObjectId().toString(),
        memberIds: [],
        invitedEmails: ['invitee@example.com'],
      }),
    };
    const guard = new ConversationOwnerGuard(conversationStore as never);
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
