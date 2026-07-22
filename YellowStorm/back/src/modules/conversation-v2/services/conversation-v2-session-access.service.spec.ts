import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  CONVERSATION_V2_OWNER_SESSION_PERMISSIONS,
} from '../constants/conversation-v2-session-permissions';
import { ConversationV2AppShareService } from './conversation-v2-app-share.service';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2SessionAccessService } from './conversation-v2-session-access.service';

describe('ConversationV2SessionAccessService', () => {
  let svc: ConversationV2SessionAccessService;
  const sessions = { getById: jest.fn() };
  const appShares = { hasConversationAccess: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationV2SessionAccessService,
        { provide: ConversationV2SessionService, useValue: sessions },
        { provide: ConversationV2AppShareService, useValue: appShares },
      ],
    }).compile();
    svc = module.get(ConversationV2SessionAccessService);
  });

  it('returns owner permissions for the session owner', async () => {
    const sessionId = new Types.ObjectId();
    sessions.getById.mockResolvedValueOnce({ _id: sessionId, ownerId: 'owner-1' });

    await expect(svc.resolve('owner-1', sessionId.toString())).resolves.toEqual({
      sessionId: sessionId.toString(),
      viewerRole: 'owner',
      permissions: CONVERSATION_V2_OWNER_SESSION_PERMISSIONS,
    });
  });

  it('returns full owner-equivalent permissions for a marketplace recipient', async () => {
    const sessionId = new Types.ObjectId();
    sessions.getById.mockResolvedValueOnce({ _id: sessionId, ownerId: 'owner-1' });
    appShares.hasConversationAccess.mockResolvedValueOnce(true);

    await expect(svc.resolve('recipient-1', sessionId.toString())).resolves.toEqual({
      sessionId: sessionId.toString(),
      viewerRole: 'shared',
      permissions: CONVERSATION_V2_OWNER_SESSION_PERMISSIONS,
    });
  });

  it('returns null when the session does not exist', async () => {
    sessions.getById.mockResolvedValueOnce(null);
    await expect(svc.resolve('user-1', new Types.ObjectId().toString())).resolves.toBeNull();
  });
});
