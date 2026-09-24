import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useAuth } from '@/modules/auth';
import {
  UserSearchInput,
  type PendingShare,
} from '@/modules/agent/components/UserSearchInput';
import { useModuleTranslation } from '@/modules/localization';
import { searchUsers } from '../api';
import {
  useCreateStreamShare,
  useRevokeStreamShare,
  useStreamShares,
  useUpdateStreamShare,
} from '../query/hooks';

interface ShareStreamDialogProps {
  streamId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareStreamDialog({ streamId, title, open, onOpenChange }: ShareStreamDialogProps) {
  const { t } = useModuleTranslation('worky');
  const { user } = useAuth();
  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const shares = useStreamShares(streamId, open);
  const createShare = useCreateStreamShare(streamId);
  const updateShare = useUpdateStreamShare(streamId);
  const revokeShare = useRevokeStreamShare(streamId);

  useEffect(() => {
    if (open) setPendingShares([]);
  }, [open, streamId]);

  const ownerInitials = useMemo(() => {
    if (user?.profile?.firstName && user.profile.lastName) {
      return `${user.profile.firstName[0]}${user.profile.lastName[0]}`.toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() ?? 'Y';
  }, [user]);

  const handleShare = async () => {
    try {
      await Promise.all(
        pendingShares.map(({ email, permission }) =>
          createShare.mutateAsync({ email, permission }),
        ),
      );
      setPendingShares([]);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('sharing.failed'));
    }
  };

  const showMutationError = (error: unknown) => {
    showError(error instanceof Error ? error.message : t('sharing.failed'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[80vh] w-[95vw] max-w-2xl flex-col gap-0 p-0'>
        <DialogHeader className='border-b p-4 pb-3'>
          <DialogTitle className='pr-8 text-base'>{t('sharing.title', { title })}</DialogTitle>
          <DialogDescription className='sr-only'>
            {t('sharing.description', { title })}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='flex-1'>
          <div className='space-y-4 p-4'>
            <UserSearchInput
              pendingShares={pendingShares}
              onRemovePending={(id) => setPendingShares((current) => current.filter((share) => share.id !== id))}
              onAddPending={(share) => setPendingShares((current) =>
                current.some((item) => item.email === share.email)
                  ? current
                  : [...current, { ...share, id: share.email }]
              )}
              searchUsers={searchUsers}
              disabled={createShare.isPending}
            />

            {pendingShares.length > 0 ? (
              <Button className='w-full' onClick={() => void handleShare()} disabled={createShare.isPending}>
                {createShare.isPending ? t('sharing.sharing') : t('sharing.invite')}
              </Button>
            ) : null}

            <Separator />

            <div>
              <h3 className='mb-3 text-sm font-medium'>{t('sharing.peopleWithAccess')}</h3>
              <div className='space-y-1'>
                <div className='flex items-center justify-between rounded-md bg-muted/50 px-3 py-2'>
                  <div className='flex flex-1 items-center gap-3'>
                    <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 font-medium text-primary'>
                      {ownerInitials}
                    </div>
                    <div className='flex flex-col'>
                      <span className='text-sm font-medium'>{t('sharing.you')}</span>
                      <span className='text-xs text-muted-foreground'>{t('sharing.ownerBadge')}</span>
                    </div>
                  </div>
                  <span className='rounded bg-muted px-2 py-1 text-xs text-muted-foreground'>
                    {t('sharing.owner')}
                  </span>
                </div>

                {shares.data?.map((share) => {
                  const { firstName, lastName, email } = share.user;
                  const name = firstName || lastName
                    ? [firstName, lastName].filter(Boolean).join(' ')
                    : email;
                  const initials = firstName && lastName
                    ? `${firstName[0]}${lastName[0]}`.toUpperCase()
                    : email[0].toUpperCase();
                  return (
                    <div key={share.id} className='flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted/50'>
                      <div className='flex min-w-0 flex-1 items-center gap-3'>
                        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary'>
                          {initials}
                        </div>
                        <div className='flex min-w-0 flex-col'>
                          <span className='truncate text-sm font-medium'>{name}</span>
                          <span className='truncate text-xs text-muted-foreground'>{email}</span>
                        </div>
                      </div>
                      <div className='flex shrink-0 items-center gap-1'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon' className='h-8 w-8' aria-label={t('sharing.changePermission', { email })}>
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            {(['read', 'write'] as const).map((permission) => (
                              <DropdownMenuItem
                                key={permission}
                                className={cn('cursor-pointer', share.permission === permission && 'bg-muted')}
                                onClick={() => updateShare.mutate(
                                  { shareId: share.id, permission },
                                  { onError: showMutationError },
                                )}
                              >
                                {t(`sharing.${permission}`)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive'
                          aria-label={t('sharing.revoke', { email })}
                          onClick={() => revokeShare.mutate(share.id, { onError: showMutationError })}
                        >
                          <X className='h-4 w-4' />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {shares.isLoading ? (
                  <p className='py-4 text-center text-sm text-muted-foreground'>{t('sharing.loading')}</p>
                ) : null}
                {shares.isError ? (
                  <div role='alert' className='space-y-2 py-4 text-center'>
                    <p className='text-sm text-destructive'>{t('sharing.loadFailed')}</p>
                    <Button variant='outline' size='sm' onClick={() => void shares.refetch()}>
                      {t('sharing.retry')}
                    </Button>
                  </div>
                ) : null}
                {!shares.isLoading && !shares.isError && shares.data?.length === 0 ? (
                  <p className='py-4 text-center text-sm text-muted-foreground'>{t('sharing.empty')}</p>
                ) : null}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className='border-t p-4 pt-3'>
          <Button variant='outline' className='w-full' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
