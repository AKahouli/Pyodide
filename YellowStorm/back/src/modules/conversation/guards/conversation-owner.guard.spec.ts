import { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ConversationOwnerGuard } from './conversation-owner.guard';

function makeGuard(conversationStore: Record<string, jest.Mock>, hasAccess = jest.fn().mockResolvedValue(false)) {
  return new ConversationOwnerGuard(conversationStore as never, { hasAccess } as never, { assertUserAuthorized: jest.fn() } as never);
}

describe('ConversationOwnerGuard', () => {
  it.each(['files/upload-url', 'files/upload', 'files/confirm', 'messages/m/generated-images/d/url'])(
    'denies foreign conversation POST %s even with project read access', async (route) => {
      const conversationId = new Types.ObjectId().toString();
      const store = { findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId, createdBy: new Types.ObjectId().toString(), memberIds: [], invitedEmails: [],
        projectId: new Types.ObjectId().toString(),
      }) };
      const projectRead = jest.fn().mockResolvedValue(true);
      const guard = makeGuard(store, projectRead);
      const request = { user: { _id: new Types.ObjectId().toString(), email: 'outsider@example.com' },
        params: { conversationId }, method: 'POST', url: `/conversations/${conversationId}/${route}` };
      const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      expect(projectRead).not.toHaveBeenCalled();
    },
  );
  it('checks current governed audience even for an existing member', async () => {
    const userId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const store = { findActiveAccessById: jest.fn().mockResolvedValue({ id: conversationId, createdBy: new Types.ObjectId().toString(), memberIds: [userId], invitedEmails: [], runtimeMode: 'governed', governanceScopeId: 'scope-1' }) };
    const audience = { assertUserAuthorized: jest.fn().mockRejectedValue(new Error('revoked')) };
    const guard = new ConversationOwnerGuard(store as never, { hasAccess: jest.fn() } as never, audience as never);
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { _id: userId, email: 'member@example.com' }, params: { id: conversationId }, method: 'GET', url: `/conversations/${conversationId}` }) }) } as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeDefined();
    expect(audience.assertUserAuthorized).toHaveBeenCalledWith(userId, 'scope-1');
  });
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
    const guard = makeGuard(conversationStore);
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
    const guard = makeGuard(conversationStore);
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

  it.each(['active-stream', 'active-streams'])('denies %s snapshots to invited non-members', async (route) => {
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
    const guard = makeGuard(conversationStore);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: userId, email: 'invitee@example.com' },
          params: { id: conversationId.toString() },
          method: 'GET',
          url: `/conversations/${conversationId}/${route}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants read access to users with project access (owner, share, or public)', async () => {
    const ownerId = new Types.ObjectId().toString();
    const collaboratorId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const projectId = new Types.ObjectId().toString();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId,
        createdBy: ownerId,
        memberIds: [],
        invitedEmails: [],
        projectId,
      }),
    };
    const hasAccess = jest.fn().mockResolvedValue(true);
    const guard = makeGuard(conversationStore, hasAccess);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: collaboratorId, email: 'collaborator@example.com' },
          params: { id: conversationId },
          method: 'GET',
          url: `/conversations/${conversationId}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasAccess).toHaveBeenCalledWith(collaboratorId, projectId);
  });

  it('lets the project owner read a conversation a collaborator created', async () => {
    const ownerId = new Types.ObjectId().toString();
    const collaboratorId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const projectId = new Types.ObjectId().toString();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId,
        // The conversation belongs to the collaborator, not the project owner.
        createdBy: collaboratorId,
        memberIds: [],
        invitedEmails: [],
        projectId,
      }),
    };
    const hasAccess = jest.fn().mockImplementation((_userId: string, pid: string) =>
      Promise.resolve(pid === projectId),
    );
    const guard = makeGuard(conversationStore, hasAccess);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: ownerId, email: 'owner@example.com' },
          params: { id: conversationId },
          method: 'GET',
          url: `/conversations/${conversationId}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('still denies reads when the user has no project access', async () => {
    const ownerId = new Types.ObjectId().toString();
    const outsiderId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const projectId = new Types.ObjectId().toString();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId,
        createdBy: ownerId,
        memberIds: [],
        invitedEmails: [],
        projectId,
      }),
    };
    const guard = makeGuard(conversationStore, jest.fn().mockResolvedValue(false));
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: outsiderId, email: 'outsider@example.com' },
          params: { id: conversationId },
          method: 'GET',
          url: `/conversations/${conversationId}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still denies writes for project collaborators', async () => {
    const ownerId = new Types.ObjectId().toString();
    const collaboratorId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();
    const conversationStore = {
      findActiveAccessById: jest.fn().mockResolvedValue({
        id: conversationId,
        createdBy: ownerId,
        memberIds: [],
        invitedEmails: [],
        projectId: new Types.ObjectId().toString(),
      }),
    };
    const guard = makeGuard(conversationStore, jest.fn().mockResolvedValue(true));
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { _id: collaboratorId, email: 'collaborator@example.com' },
          params: { id: conversationId },
          method: 'DELETE',
          url: `/conversations/${conversationId}`,
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
