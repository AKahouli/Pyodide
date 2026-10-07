import { Injectable } from '@nestjs/common';
import {
  APP_BUILDER_OWNER_SESSION_PERMISSIONS,
  APP_BUILDER_SHARED_SESSION_PERMISSIONS,
  type AppBuilderSessionPermission,
} from '../constants/app-builder-session-permissions';
import type { AppBuilderSessionRecord } from '../persistence/app-builder-session.store';
import { AppBuilderAppShareService } from './app-builder-app-share.service';
import { AppBuilderSessionService } from './app-builder-session.service';

export type AppBuilderViewerRole = 'owner' | 'shared';

export interface AppBuilderSessionAccess {
  sessionId: string;
  viewerRole: AppBuilderViewerRole;
  permissions: AppBuilderSessionPermission[];
}

export interface AppBuilderResolvedSession {
  pointer: AppBuilderSessionRecord;
  ownerId: string;
  /** Authenticated user id (may differ from ownerId for shared access). */
  actorUserId: string;
  access: AppBuilderSessionAccess;
}

@Injectable()
export class AppBuilderSessionAccessService {
  constructor(
    private readonly sessions: AppBuilderSessionService,
    private readonly appShares: AppBuilderAppShareService,
  ) {}

  async resolve(userId: string, sessionId: string): Promise<AppBuilderSessionAccess | null> {
    const resolved = await this.resolveSession(userId, sessionId);
    return resolved?.access ?? null;
  }

  async resolveSession(
    userId: string,
    sessionId: string,
  ): Promise<AppBuilderResolvedSession | null> {
    const pointer = await this.sessions.getById(sessionId);
    if (!pointer) return null;

    const ownerId = pointer.ownerId;

    if (ownerId === userId) {
      return {
        pointer,
        ownerId,
        actorUserId: userId,
        access: {
          sessionId,
          viewerRole: 'owner',
          permissions: [...APP_BUILDER_OWNER_SESSION_PERMISSIONS],
        },
      };
    }

    const shared = await this.appShares.hasConversationAccess(userId, sessionId);
    if (!shared) return null;

    return {
      pointer,
      ownerId,
      actorUserId: userId,
      access: {
        sessionId,
        viewerRole: 'shared',
        permissions: [...APP_BUILDER_SHARED_SESSION_PERMISSIONS],
      },
    };
  }
}
