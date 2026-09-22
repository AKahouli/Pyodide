/**
 * Share Project Dialog — mirrors ShareWorkspaceDialog: public toggle, user
 * search by email, and a "people with access" list with permission controls.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
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
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { UserSearchInput } from '@/modules/workspace/components/ShareWorkspaceDialog/UserSearchInput';
import { ShareRow } from '@/modules/workspace/components/ShareWorkspaceDialog/ShareRow';
import { GroupShareSelector } from '@/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector';
import type { WorkspacePermission, WorkspaceShareResponse } from '@/modules/workspace/types';
import * as api from '../api';
import type { Project, ProjectShareResponse } from '../types';

interface PendingShare {
  id: string;
  email: string;
  permission: WorkspacePermission;
}

interface ShareProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export function ShareProjectDialog({ open, onOpenChange, project }: ShareProjectDialogProps) {
  const { t } = useModuleTranslation('workspace');
  const { t: tProject } = useModuleTranslation('sidebar');
  const { user } = useAuth();

  const [shares, setShares] = useState<ProjectShareResponse[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isSharingInProgress, setIsSharingInProgress] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(project.isPublic);
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

  const fetchShares = useCallback(async () => {
    setIsLoadingShares(true);
    try {
      const result = await api.getProjectShares(project.id);
      setShares(result.shares);
    } catch {
      // Share list is non-critical; the dialog still works for new shares.
    } finally {
      setIsLoadingShares(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (open) {
      setIsPublic(project.isPublic);
      fetchShares();
    } else {
      setPendingShares([]);
    }
  }, [open, project.id, project.isPublic, fetchShares]);

  const closeModal = () => onOpenChange(false);

  const handleAddPending = useCallback((share: Omit<PendingShare, 'id'>) => {
    setPendingShares((prev) => [
      ...prev,
      { ...share, id: `${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}` },
    ]);
  }, []);

  const handleRemovePending = useCallback((id: string) => {
    setPendingShares((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleAddGroupShares = useCallback(
    (entries: { email: string; permission: WorkspacePermission }[]) => {
      if (entries.length === 0) return;
      setPendingShares((prev) => [
        ...prev,
        ...entries.map((s) => ({
          ...s,
          id: `${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}-${s.email}`,
        })),
      ]);
    },
    [],
  );

  const handleShare = async () => {
    if (pendingShares.length === 0) return;
    setIsSharingInProgress(true);
    try {
      const result = await api.shareProject(project.id, {
        shares: pendingShares.map((s) => ({ email: s.email, permission: s.permission })),
      });
      if (result.notFound.length > 0) {
        toast.warning(tProject('projects.toasts.shareNotFound', { emails: result.notFound.join(', ') }));
      }
      if (result.shared.length > 0) {
        setPendingShares([]);
        await fetchShares();
      }
    } catch {
      toast.error(tProject('projects.toasts.shareError'));
    } finally {
      setIsSharingInProgress(false);
    }
  };

  const handleToggleVisibility = async (next: boolean) => {
    setVisibilityBusy(true);
    try {
      await api.setVisibility(project.id, next);
      setIsPublic(next);
    } catch {
      toast.error(tProject('projects.toasts.visibilityError'));
    } finally {
      setVisibilityBusy(false);
    }
  };

  const handleUpdatePermission = async (shareId: string, permission: WorkspacePermission) => {
    try {
      await api.updateSharePermission(project.id, shareId, permission);
      await fetchShares();
    } catch {
      toast.error(tProject('projects.toasts.shareError'));
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await api.revokeShare(project.id, shareId);
      await fetchShares();
    } catch {
      toast.error(tProject('projects.toasts.shareError'));
    }
  };

  const handleSearchUsers = useCallback((query: string) => api.searchUsers(query), []);

  // ShareRow is workspace-typed; project shares carry the same fields modulo
  // the resource id key, so adapt at the boundary.
  const toShareRow = (share: ProjectShareResponse): WorkspaceShareResponse => ({
    ...share,
    workspaceId: share.projectId,
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeModal()}>
      <DialogContent className='w-[95vw] max-w-2xl p-0 gap-0 max-h-[80vh] flex flex-col'>
        <DialogHeader className='p-4 pb-3 border-b'>
          <DialogTitle className='text-base pr-8'>
            {t('sharing.share')} &quot;{project.name}&quot;
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
                  disabled={isSharingInProgress || visibilityBusy}
                />

                <UserSearchInput
                  pendingShares={pendingShares}
                  onRemovePending={handleRemovePending}
                  onAddPending={handleAddPending}
                  searchUsers={handleSearchUsers}
                  disabled={isSharingInProgress || visibilityBusy}
                />

                {pendingShares.length > 0 && (
                  <Button onClick={handleShare} disabled={isSharingInProgress} className='w-full'>
                    {isSharingInProgress ? t('sharing.sharing') : t('sharing.invite')}
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
                      <span className='text-xs text-muted-foreground'>{t('sharing.ownerBadge')}</span>
                    </div>
                  </div>
                  <span className='text-xs px-2 py-1 rounded bg-muted text-muted-foreground'>
                    {t('sharing.permission.owner')}
                  </span>
                </div>

                {shares.map((share) => (
                  <ShareRow
                    key={share.id}
                    share={toShareRow(share)}
                    onUpdatePermission={handleUpdatePermission}
                    onRevoke={handleRevoke}
                    disabled={isLoadingShares}
                  />
                ))}

                {shares.length === 0 && !isLoadingShares && (
                  <p className='text-sm text-muted-foreground text-center py-4'>{t('sharing.noAccess')}</p>
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
