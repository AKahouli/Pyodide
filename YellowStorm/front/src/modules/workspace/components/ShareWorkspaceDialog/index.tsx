/**
 * Share Workspace Dialog
 * Main dialog for sharing workspaces with other users
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { useWorkspaceStore } from '../../store';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { UserSearchInput } from './UserSearchInput';
import { ShareRow } from './ShareRow';
import { GroupShareSelector } from './GroupShareSelector';
import type { WorkspacePermission } from '../../types';

interface PendingShare {
  id: string;
  email: string;
  permission: WorkspacePermission;
}

export function ShareWorkspaceDialog() {
  const { t } = useModuleTranslation('workspace');
  const { user } = useAuth();
  const isOpen = useWorkspaceStore((state) => state.isShareModalOpen);
  const shareModalWorkspace = useWorkspaceStore((state) => state.shareModalWorkspace);
  const workspaceShares = useWorkspaceStore((state) => state.workspaceShares);
  const isLoadingShares = useWorkspaceStore((state) => state.isLoadingShares);
  const isSharingInProgress = useWorkspaceStore((state) => state.isSharingInProgress);

  const closeShareModal = useWorkspaceStore((state) => state.closeShareModal);
  const shareWorkspace = useWorkspaceStore((state) => state.shareWorkspace);
  const updateSharePermission = useWorkspaceStore((state) => state.updateSharePermission);
  const revokeShare = useWorkspaceStore((state) => state.revokeShare);
  const searchUsers = useWorkspaceStore((state) => state.searchUsers);
  const fetchWorkspaceShares = useWorkspaceStore((state) => state.fetchWorkspaceShares);
  const setWorkspaceVisibility = useWorkspaceStore((state) => state.setWorkspaceVisibility);
  const isPublic = shareModalWorkspace?.isPublic ?? false;
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);

  const userInitials = useMemo(() => {
    if (user?.profile?.firstName && user?.profile?.lastName) {
      return `${user.profile.firstName.charAt(0)}${user.profile.lastName.charAt(0)}`.toUpperCase();
    }
    if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'Y';
  }, [user]);

  const closeModal = useCallback(() => {
    closeShareModal();
    setPendingShares([]);
  }, [closeShareModal]);

  const handleAddPending = useCallback((share: Omit<PendingShare, 'id'>) => {
    setPendingShares((prev) => [
      ...prev,
      {
        ...share,
        id: `${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}`,
      },
    ]);
  }, []);

  const handleRemovePending = useCallback((id: string) => {
    setPendingShares((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleAddGroupShares = useCallback(
    (shares: { email: string; permission: WorkspacePermission }[]) => {
      if (shares.length === 0) return;
      setPendingShares((prev) => [
        ...prev,
        ...shares.map((s) => ({
          ...s,
          id: `${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}-${s.email}`,
        })),
      ]);
    },
    [],
  );

  const handleShare = async () => {
    if (!shareModalWorkspace || pendingShares.length === 0) return;

    try {
      const result = await shareWorkspace(shareModalWorkspace.id, {
        shares: pendingShares.map((s) => ({ email: s.email, permission: s.permission })),
      });

      if (result.shared.length > 0) {
        setPendingShares([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleVisibility = async (next: boolean) => {
    if (!shareModalWorkspace) return;
    setVisibilityBusy(true);
    try {
      await setWorkspaceVisibility(shareModalWorkspace.id, next);
    } catch {
      // store surfaces the error
    } finally {
      setVisibilityBusy(false);
    }
  };

  const handleUpdatePermission = async (shareId: string, permission: WorkspacePermission) => {
    if (!shareModalWorkspace) return;
    await updateSharePermission(shareModalWorkspace.id, shareId, permission);
  };

  const handleRevoke = async (shareId: string) => {
    if (!shareModalWorkspace) return;
    await revokeShare(shareModalWorkspace.id, shareId);
  };

  const handleSearchUsers = useCallback(
    (query: string) => searchUsers(query),
    [searchUsers],
  );

  useEffect(() => {
    if (isOpen && shareModalWorkspace) {
      fetchWorkspaceShares(shareModalWorkspace.id).catch(() => {});
    }
  }, [isOpen, shareModalWorkspace, fetchWorkspaceShares]);

  if (!shareModalWorkspace) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className='w-[95vw] max-w-2xl p-0 gap-0 max-h-[80vh] flex flex-col'>
        <DialogHeader className='p-4 pb-3 border-b'>
          <DialogTitle className='text-base pr-8'>
            {t('sharing.share')} "{shareModalWorkspace.name}"
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className='flex-1'>
          <div className='p-4 space-y-4'>
            <div className='flex items-start justify-between gap-4 rounded-md border p-3'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium'>{t('sharing.visibility.title')}</p>
                <p className='text-xs text-muted-foreground'>
                  {isPublic ? t('sharing.visibility.publicHint') : t('sharing.visibility.privateHint')}
                </p>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={handleToggleVisibility}
                disabled={visibilityBusy || isSharingInProgress}
                aria-label={t('sharing.visibility.title')}
              />
            </div>

            {isPublic && (
              <p className='rounded-md bg-muted/50 p-3 text-xs text-muted-foreground'>
                {t('sharing.visibility.publicNote')}
              </p>
            )}

            {!isPublic && (
              <>
                <GroupShareSelector
                  existingEmails={pendingShares.map((s) => s.email)}
                  ownerEmail={user?.email ?? ''}
                  onExpand={handleAddGroupShares}
                  disabled={isSharingInProgress}
                />

                <UserSearchInput
                  pendingShares={pendingShares}
                  onRemovePending={handleRemovePending}
                  onAddPending={handleAddPending}
                  searchUsers={handleSearchUsers}
                  disabled={isSharingInProgress}
                />

                {pendingShares.length > 0 && (
                  <Button onClick={handleShare} disabled={isSharingInProgress} className='w-full'>
                    {isSharingInProgress
                      ? t('sharing.sharing')
                      : t('sharing.invite')}
                  </Button>
                )}
              </>
            )}

            <Separator />

            <div>
              <h3 className='text-sm font-medium mb-3'>{t('sharing.peopleWithAccess')}</h3>

              <div className='space-y-1'>
                <div className='flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md'>
                  <div className='flex items-center gap-3 flex-1'>
                    <div className='h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium shrink-0'>
                      {userInitials}
                    </div>
                    <div className='flex flex-col'>
                      <span className='text-sm font-medium'>{t('sharing.you')}</span>
                      <span className='text-xs text-muted-foreground'>
                        {t('sharing.ownerBadge')}
                      </span>
                    </div>
                  </div>
                  <span className='text-xs px-2 py-1 rounded bg-muted text-muted-foreground'>
                    {t('sharing.permission.owner')}
                  </span>
                </div>

                {workspaceShares.map((share) => (
                  <ShareRow
                    key={share.id}
                    share={share}
                    onUpdatePermission={handleUpdatePermission}
                    onRevoke={handleRevoke}
                    disabled={isLoadingShares}
                  />
                ))}

                {workspaceShares.length === 0 && !isLoadingShares && (
                  <p className='text-sm text-muted-foreground text-center py-4'>
                    {t('sharing.noAccess')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className='p-4 pt-3 border-t'>
          <Button variant='outline' onClick={closeModal} className='w-full'>
            {t('sharing.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
