import { newObjectId } from '@common/postgres';
import { PlaybookShareService } from './playbook-share.service';

describe('PlaybookShareService', () => {
  const ownerId = newObjectId();
  const recipientId = newObjectId();
  const playbookId = newObjectId();
  const shareRecord = (over: Record<string, unknown> = {}) => ({
    id: 'share-1',
    playbookId,
    sharedBy: ownerId,
    sharedWith: recipientId,
    permission: 'read',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });
  const recipient = { id: recipientId, email: 'recipient@example.com', firstName: 'Shared', lastName: 'User' };
  const owner = { id: ownerId, email: 'owner@example.com', firstName: 'Own', lastName: 'Er' };

  const build = () => {
    const shares = {
      upsert: jest.fn().mockResolvedValue(shareRecord()),
      listForPlaybook: jest.fn().mockResolvedValue([shareRecord()]),
      listSharedWith: jest.fn().mockResolvedValue([shareRecord({ permission: 'write' })]),
      listPlaybookIdsSharedWith: jest.fn().mockResolvedValue([playbookId]),
      findPermission: jest.fn().mockResolvedValue('write'),
      updatePermission: jest.fn().mockResolvedValue(shareRecord({ permission: 'write' })),
      delete: jest.fn().mockResolvedValue(shareRecord()),
      deleteAllForPlaybook: jest.fn().mockResolvedValue(2),
    };
    const userLookup = {
      byEmails: jest.fn().mockResolvedValue(new Map([['recipient@example.com', recipient]])),
      byIds: jest.fn().mockResolvedValue(new Map([[recipientId, recipient], [ownerId, owner]])),
    };
    const streamEvents = { emitPlaybookShared: jest.fn() };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const service = new PlaybookShareService(shares as never, userLookup as never, streamEvents as never, logger as never);
    return { service, shares, userLookup, streamEvents, logger };
  };

  it('notifies each recipient after persisting the share', async () => {
    const { service, shares, streamEvents } = build();

    const result = await service.sharePlaybook(ownerId, playbookId, {
      emails: ['RECIPIENT@example.com', ' recipient@example.com '],
      permission: 'read',
    });

    expect(shares.upsert).toHaveBeenCalledTimes(1);
    expect(shares.upsert).toHaveBeenCalledWith(playbookId, recipientId, ownerId, 'read');
    expect(streamEvents.emitPlaybookShared).toHaveBeenCalledWith(recipientId, playbookId);
    expect(result).toEqual([{
      shareId: 'share-1',
      permission: 'read',
      user: { id: recipientId, email: 'recipient@example.com', firstName: 'Shared', lastName: 'User' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }]);
  });

  it('rejects unknown recipients and sharing with oneself', async () => {
    const { service, shares, userLookup } = build();
    userLookup.byEmails.mockResolvedValueOnce(new Map());
    await expect(service.sharePlaybook(ownerId, playbookId, { emails: ['ghost@example.com'], permission: 'read' }))
      .rejects.toMatchObject({ status: 404, response: { error: 'Unknown recipient(s): ghost@example.com' } });
    userLookup.byEmails.mockResolvedValueOnce(new Map([['owner@example.com', owner]]));
    await expect(service.sharePlaybook(ownerId, playbookId, { emails: ['owner@example.com'], permission: 'read' }))
      .rejects.toMatchObject({ status: 400, response: { error: 'You cannot share a playbook with yourself' } });
    expect(shares.upsert).not.toHaveBeenCalled();
  });

  it('lists, updates and removes the grants of a playbook', async () => {
    const { service, shares } = build();

    await expect(service.getPlaybookShares(playbookId)).resolves.toEqual([expect.objectContaining({ shareId: 'share-1', user: expect.objectContaining({ id: recipientId }) })]);
    await expect(service.updateSharePermission(playbookId, 'share-1', { permission: 'write' })).resolves.toMatchObject({ permission: 'write' });
    expect(shares.updatePermission).toHaveBeenCalledWith(playbookId, 'share-1', 'write');
    await expect(service.removeShare(playbookId, 'share-1')).resolves.toBeUndefined();

    shares.updatePermission.mockResolvedValueOnce(null);
    const notFound = { status: 404, response: { error: 'Playbook share not found' } };
    await expect(service.updateSharePermission(playbookId, 'bad', { permission: 'write' })).rejects.toMatchObject(notFound);
    shares.delete.mockResolvedValueOnce(null);
    await expect(service.removeShare(playbookId, 'bad')).rejects.toMatchObject(notFound);

    await service.removeAllSharesForPlaybook(playbookId);
    expect(shares.deleteAllForPlaybook).toHaveBeenCalledWith(playbookId);
  });

  it('answers the recipient-side lookups', async () => {
    const { service } = build();

    await expect(service.getSharePermission(recipientId, playbookId)).resolves.toBe('write');
    await expect(service.getSharedPlaybookIdsForUser(recipientId)).resolves.toEqual([playbookId]);
    const info = await service.getShareInfoMapForUser(recipientId);
    expect(info.get(playbookId)).toEqual({
      shareId: 'share-1',
      permission: 'write',
      sharedBy: { id: ownerId, email: 'owner@example.com', firstName: 'Own', lastName: 'Er' },
    });
  });
});
