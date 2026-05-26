import { MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceShareResponse, WorkspacePermission } from '../../types';

interface ShareRowProps {
  share: WorkspaceShareResponse;
  onUpdatePermission: (shareId: string, permission: WorkspacePermission) => void;
  onRevoke: (shareId: string) => void;
  disabled?: boolean;
}

export function ShareRow({
  share,
  onUpdatePermission,
  onRevoke,
  disabled,
}: Readonly<ShareRowProps>) {
  const { t } = useModuleTranslation('workspace');
  const isReadPermission = share.permission === 'read';
  const { firstName, lastName, email } = share.user;

  const displayName =
    firstName || lastName ? [firstName, lastName].filter(Boolean).join(' ') : email;

  const initials =
    firstName && lastName
      ? `${firstName[0]}${lastName[0]}`.toUpperCase()
      : email.charAt(0).toUpperCase();

  return (
    <div className='flex items-center justify-between py-2 px-3 hover:bg-muted/50 rounded-md transition-colors'>
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
            <Button variant='ghost' size='icon' className='h-8 w-8' disabled={disabled}>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={() => onUpdatePermission(share.id, 'read')}
              className={cn('cursor-pointer', isReadPermission && 'bg-muted')}
            >
              {t('sharing.permission.readBadge')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onUpdatePermission(share.id, 'readwrite')}
              className={cn('cursor-pointer', !isReadPermission && 'bg-muted')}
            >
              {t('sharing.permission.readwriteBadge')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant='ghost'
          size='icon'
          className='h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10'
          onClick={() => onRevoke(share.id)}
          disabled={disabled}
        >
          <X className='h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
