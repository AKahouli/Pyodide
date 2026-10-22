import { Test, TestingModule } from '@nestjs/testing';
import {
  APP_BUILDER_OWNER_SESSION_PERMISSIONS,
} from '../constants/app-builder-session-permissions';
import { AppBuilderAppShareService } from './app-builder-app-share.service';
import { AppBuilderSessionService } from './app-builder-session.service';
import { AppBuilderSessionAccessService } from './app-builder-session-access.service';

const SESSION_HEX = 'a'.repeat(24);

describe('AppBuilderSessionAccessService', () => {
  let svc: AppBuilderSessionAccessService;
  const sessions = { getById: jest.fn() };
  const appShares = { hasConversationAccess: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppBuilderSessionAccessService,
        { provide: AppBuilderSessionService, useValue: sessions },
        { provide: AppBuilderAppShareService, useValue: appShares },
      ],
    }).compile();
    svc = module.get(AppBuilderSessionAccessService);
  });

  it('returns owner permissions for the session owner', async () => {
    const sessionId = SESSION_HEX;
    sessions.getById.mockResolvedValueOnce({ id: sessionId, ownerId: 'owner-1' });

    await expect(svc.resolve('owner-1', sessionId)).resolves.toEqual({
      sessionId,
      viewerRole: 'owner',
      permissions: APP_BUILDER_OWNER_SESSION_PERMISSIONS,
    });
  });

  it('returns full owner-equivalent permissions for a marketplace recipient', async () => {
    const sessionId = SESSION_HEX;
    sessions.getById.mockResolvedValueOnce({ id: sessionId, ownerId: 'owner-1' });
    appShares.hasConversationAccess.mockResolvedValueOnce(true);

    await expect(svc.resolve('recipient-1', sessionId)).resolves.toEqual({
      sessionId,
      viewerRole: 'shared',
      permissions: APP_BUILDER_OWNER_SESSION_PERMISSIONS,
    });
  });

  it('returns null when the session does not exist', async () => {
    sessions.getById.mockResolvedValueOnce(null);
    await expect(svc.resolve('user-1', SESSION_HEX)).resolves.toBeNull();
  });
});
