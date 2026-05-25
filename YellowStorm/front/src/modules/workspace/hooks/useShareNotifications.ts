/**
 * Hook to listen for workspace share SSE notifications and keep local state in sync.
 * - workspace_shared:        invalidate shared-workspace cache, toast.
 * - workspace_share_revoked: invalidate cache, deselect if viewing the revoked workspace, toast.
 * - workspace_share_updated: update permission in cache, toast.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../store';
import { notificationsService, type Notification, type SSEEvent } from '@/modules/notifications';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspacePermission } from '../types';

type ShareEventType = 'workspace_shared' | 'workspace_share_revoked' | 'workspace_share_updated';

interface ShareNotificationData {
  eventType: ShareEventType;
  workspaceId: string;
  workspaceName: string;
  shareId: string;
  permission?: WorkspacePermission;
  owner?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

export function useShareNotifications() {
  const { t } = useModuleTranslation('workspace');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const handleEvent = (event: SSEEvent) => {
      if (event.type !== 'notification') return;
      const notification = event.data as Notification;
      if (notification?.metadata?.sourceModule !== 'workspace-share') return;

      const data = notification.data as ShareNotificationData | undefined;
      if (!data?.eventType) return;

      const state = useWorkspaceStore.getState();
      const translate = tRef.current;

      if (data.eventType === 'workspace_shared') {
        state.invalidateSharedWorkspaceCache();
        if (state.activeTab === 'shared') {
          state.fetchSharedWorkspaces(1).catch(() => {});
        }
        const ownerName =
          data.owner?.firstName && data.owner?.lastName
            ? `${data.owner.firstName} ${data.owner.lastName}`
            : data.owner?.email ?? '';
        toast.success(
          translate('sharing.sharedNotification', {
            name: ownerName,
            workspace: data.workspaceName,
          }),
        );
        return;
      }

      if (data.eventType === 'workspace_share_revoked') {
        state.invalidateSharedWorkspaceCache();
        if (state.activeTab === 'shared') {
          state.fetchSharedWorkspaces(1).catch(() => {});
        }
        if (
          state.selectedWorkspaceId === data.workspaceId &&
          state.selectedWorkspaceRole !== 'owner'
        ) {
          useWorkspaceStore.setState({
            selectedWorkspaceId: null,
            selectedWorkspace: null,
            selectedSharedWorkspaceInfo: null,
            selectedWorkspaceRole: 'owner',
          });
        }
        toast.warning(
          translate('sharing.revokedNotification', { workspace: data.workspaceName }),
        );
        return;
      }

      if (data.eventType === 'workspace_share_updated' && data.permission) {
        const newCache = new Map(state.sharedWorkspaces);
        let mutated = false;
        newCache.forEach((workspaces, page) => {
          const idx = workspaces.findIndex((w) => w.id === data.workspaceId);
          if (idx !== -1) {
            const copy = [...workspaces];
            copy[idx] = { ...copy[idx], permission: data.permission as WorkspacePermission };
            newCache.set(page, copy);
            mutated = true;
          }
        });
        const patch: Record<string, unknown> = mutated ? { sharedWorkspaces: newCache } : {};
        if (
          state.selectedWorkspaceId === data.workspaceId &&
          state.selectedWorkspaceRole !== 'owner'
        ) {
          patch.selectedWorkspaceRole = data.permission;
          if (state.selectedSharedWorkspaceInfo) {
            patch.selectedSharedWorkspaceInfo = {
              ...state.selectedSharedWorkspaceInfo,
              permission: data.permission,
            };
          }
        }
        if (Object.keys(patch).length > 0) {
          useWorkspaceStore.setState(patch);
        }
        const permLabel =
          data.permission === 'read'
            ? translate('sharing.permission.read')
            : translate('sharing.permission.readwrite');
        toast.info(`${data.workspaceName}: ${permLabel}`);
      }
    };

    const unsubscribe = notificationsService.subscribe(handleEvent);
    return () => unsubscribe();
  }, []);
}
