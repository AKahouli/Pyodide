import { Types } from 'mongoose';
import { PlaybookShareService } from './playbook-share.service';

describe('PlaybookShareService', () => {
  it('notifies each recipient after persisting the share', async () => {
    const ownerId = new Types.ObjectId().toString();
    const recipientId = new Types.ObjectId().toString();
    const playbookId = new Types.ObjectId().toString();
    const share = {
      _id: new Types.ObjectId(),
      permission: 'read',
      createdAt: new Date(),
    };
    const sharedPlaybookModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue(share),
    };
    const userLookup = {
      byEmails: jest.fn().mockResolvedValue(new Map([
        ['recipient@example.com', {
          id: recipientId,
          email: 'recipient@example.com',
          firstName: 'Shared',
          lastName: 'User',
        }],
      ])),
    };
    const streamEvents = { emitPlaybookShared: jest.fn() };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const service = new PlaybookShareService(
      sharedPlaybookModel as never,
      userLookup as never,
      streamEvents as never,
      logger as never,
    );

    await service.sharePlaybook(ownerId, playbookId, {
      emails: ['RECIPIENT@example.com'],
      permission: 'read',
    });

    expect(sharedPlaybookModel.findOneAndUpdate).toHaveBeenCalled();
    expect(streamEvents.emitPlaybookShared).toHaveBeenCalledWith(recipientId, playbookId);
  });
});
