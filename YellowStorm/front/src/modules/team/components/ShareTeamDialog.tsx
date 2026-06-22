/**
 * Share Team Dialog — same UX as the workspace share modal: a user-search
 * autocomplete (chips + read/write picker) plus a "people with access" list.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import * as api from '../api';
import type { Team, TeamShareEntry, TeamPermissionLevel } from '../types';
import { UserSearchInput, type PendingShare } from './UserSearchInput';

interface ShareTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
}

export function ShareTeamDialog({ open, onOpenChange, team }: ShareTeamDialogProps) {
  const { t } = useModuleTranslation('team');
  const { user } = useAuth();

  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const [shares, setShares] = useState<TeamShareEntry[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [sharing, setSharing] = useState(false);

  const fetchShares = useCallback(async () => {
    setLoadingShares(true);
    try {
      setShares(await api.getTeamShares(team.id));
    } catch {
      // Shares list is supplementary — fail silently.
    } finally {
      setLoadingShares(false);
    }
  }, [team.id]);

  useEffect(() => {
    if (open) {
      setPendingShares([]);
      void fetchShares();
    }
  }, [open, fetchShares]);

  const userInitials = useMemo(() => {
    if (user?.profile?.firstName && user?.profile?.lastName) {
      return `${user.profile.firstName.charAt(0)}${user.profile.lastName.charAt(0)}`.toUpperCase();
    }
    if (user?.email) return user.email.charAt(0).toUpperCase();
    return 'Y';
  }, [user]);

  const handleAddPending = useCallback((share: Omit<PendingShare, 'id'>) => {
    setPendingShares((prev) =>
      prev.some((p) => p.email === share.email)
        ? prev
        : [...prev, { ...share, id: `${prev.length}-${share.email}` }],
    );
  }, []);

  const handleRemovePending = useCallback((id: string) => {
    setPendingShares((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleShare = async () => {
    if (pendingShares.length === 0) return;
    setSharing(true);
    try {
      // The backend shares a batch under one permission, so group by permission.
      const groups: Record<TeamPermissionLevel, string[]> = { read: [], write: [] };
      for (const p of pendingShares) groups[p.permission].push(p.email);
      const calls: Promise<unknown>[] = [];
      if (groups.read.length) calls.push(api.shareTeam(team.id, { emails: groups.read, permission: 'read' }));
      if (groups.write.length) calls.push(api.shareTeam(team.id, { emails: groups.write, permission: 'write' }));
      await Promise.all(calls);

      toast.success(t('store.toasts.teamShared'), {
        description: t('store.toasts.teamSharedDescription', { name: team.name }),
      });
      setPendingShares([]);
      void fetchShares();
    } catch (err) {
      toast.error(t('store.errors.shareFailed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSharing(false);
    }
  };

  const handleUpdatePermission = async (shareId: string, permission: TeamPermissionLevel) => {
    try {
      const updated = await api.updateTeamSharePermission(team.id, shareId, permission);
      setShares((prev) => prev.map((s) => (s.shareId === shareId ? updated : s)));
      toast.success(t('store.toasts.sharePermissionUpdated'), {
        description: t('store.toasts.sharePermissionUpdatedDescription'),
      });
    } catch (err) {
      toast.error(t('store.errors.shareRemoveFailed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await api.removeTeamShare(team.id, shareId);
      setShares((prev) => prev.filter((s) => s.shareId !== shareId));
      toast.success(t('store.toasts.shareRemoved'), {
        description: t('store.toasts.shareRemovedDescription'),
      });
    } catch (err) {
      toast.error(t('store.errors.shareRemoveFailed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-[95vw] max-w-2xl p-0 gap-0 max-h-[80vh] flex flex-col'>
        <DialogHeader className='p-4 pb-3 border-b'>
          <DialogTitle className='text-base pr-8'>
            {t('share.title')} "{team.name}"
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className='flex-1'>
          <div className='p-4 space-y-4'>
            <UserSearchInput
              pendingShares={pendingShares}
              onRemovePending={handleRemovePending}
              onAddPending={handleAddPending}
              searchUsers={api.searchUsers}
              disabled={sharing}
            />

            {pendingShares.length > 0 && (
              <Button onClick={handleShare} disabled={sharing} className='w-full'>
                {sharing ? t('share.actions.sharing') : t('share.invite')}
              </Button>
            )}

            <Separator />

            <div>
              <h3 className='text-sm font-medium mb-3'>{t('share.peopleWithAccess')}</h3>
              <div className='space-y-1'>
                {/* Owner row */}
                <div className='flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md'>
                  <div className='flex items-center gap-3 flex-1'>
                    <div className='h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium shrink-0'>
                      {userInitials}
                    </div>
                    <div className='flex flex-col'>
                      <span className='text-sm font-medium'>{t('share.you')}</span>
                      <span className='text-xs text-muted-foreground'>{t('share.ownerBadge')}</span>
                    </div>
                  </div>
                  <span className='text-xs px-2 py-1 rounded bg-muted text-muted-foreground'>
                    {t('share.permissionOwner')}
                  </span>
                </div>

                {shares.map((share) => {
                  const { firstName, lastName, email } = share.user;
                  const displayName =
                    firstName || lastName ? [firstName, lastName].filter(Boolean).join(' ') : email;
                  const initials =
                    firstName && lastName
                      ? `${firstName[0]}${lastName[0]}`.toUpperCase()
                      : email.charAt(0).toUpperCase();
                  const isRead = share.permission === 'read';
                  return (
                    <div
                      key={share.shareId}
                      className='flex items-center justify-between py-2 px-3 hover:bg-muted/50 rounded-md transition-colors'>
                      <div className='flex items-center gap-3 flex-1 min-w-0'>
                        <div className='h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium shrink-0'>
                          {initials}
                        </div>
                        <div className='flex flex-col min-w-0'>
                          <span className='text-sm font-medium truncate'>{displayName}</span>
                          {email && <span className='text-xs text-muted-foreground truncate'>{email}</span>}
                        </div>
                      </div>
                      <div className='flex items-center gap-1 shrink-0'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon' className='h-8 w-8' disabled={loadingShares}>
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onClick={() => handleUpdatePermission(share.shareId, 'read')}
                              className={cn('cursor-pointer', isRead && 'bg-muted')}>
                              {t('share.permissionRead')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdatePermission(share.shareId, 'write')}
                              className={cn('cursor-pointer', !isRead && 'bg-muted')}>
                              {t('share.permissionWrite')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10'
                          onClick={() => handleRevoke(share.shareId)}
                          disabled={loadingShares}>
                          <X className='h-4 w-4' />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {shares.length === 0 && !loadingShares && (
                  <p className='text-sm text-muted-foreground text-center py-4'>{t('share.noAccess')}</p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className='p-4 pt-3 border-t'>
          <Button variant='outline' onClick={() => onOpenChange(false)} className='w-full'>
            {t('createEdit.actions.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
