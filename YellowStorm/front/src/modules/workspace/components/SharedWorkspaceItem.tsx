/**
 * Shared Workspace Item
 * Single shared workspace item in sidebar with owner info and permission badge
 */

import { memo } from 'react';
import { Users, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { SharedWorkspaceResponse } from '../types';
import { formatFileSize } from '../utils';

interface SharedWorkspaceItemProps {
  workspace: SharedWorkspaceResponse;
  isSelected: boolean;
  onSelect: () => void;
}

export const SharedWorkspaceItem = memo(function SharedWorkspaceItem({
  workspace,
  isSelected,
  onSelect,
}: SharedWorkspaceItemProps) {
  const { t } = useModuleTranslation('workspace');

  const ownerName =
    workspace.owner.firstName && workspace.owner.lastName
      ? `${workspace.owner.firstName.charAt(0)} ${workspace.owner.lastName.charAt(0)}.`
      : workspace.owner.email.split('@')[0];

  const permissionLabel =
    workspace.permission === 'read'
      ? t('sharing.permission.read')
      : t('sharing.permission.readwrite');

  return (
    <div
      className={cn(
        'group/item relative flex flex-col p-2 rounded-lg cursor-pointer transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
      onClick={onSelect}
    >
      <div className='flex-1 min-w-0'>
        <div className='font-medium text-sm truncate'>{workspace.name}</div>
        <div className='flex items-center gap-2 text-xs text-muted-foreground mt-1'>
          <span className='flex items-center gap-1'>
            <Users className='h-3 w-3' />
            {ownerName}
          </span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium',
              workspace.permission === 'read'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
            )}
          >
            {permissionLabel}
          </span>
        </div>
        <div className='flex items-center gap-2 text-xs text-muted-foreground mt-1'>
          <span className='flex items-center gap-1'>
            <FileText className='h-3 w-3' />
            {workspace.documentCount}
          </span>
          <span>{formatFileSize(workspace.usedStorage)}</span>
        </div>
      </div>
    </div>
  );
});
