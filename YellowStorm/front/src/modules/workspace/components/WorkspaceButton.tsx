/**
 * Workspace Button Component
 * Sidebar entry that navigates to the workspace page.
 * 3-dot menu keeps quick access to create workspace / template modals.
 */

import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, MoreHorizontal, Plus, FileText } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuAction } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';
import { useWorkspaceStoreTranslator } from '../hooks/useWorkspaceStoreTranslator';

export const WorkspaceButton = memo(function WorkspaceButton({ label }: { label?: string }) {
  const { t } = useModuleTranslation('workspace');
  const { t: tCommon } = useModuleTranslation('common');
  useWorkspaceStoreTranslator();
  const navigate = useNavigate();
  const openCreateModal = useWorkspaceStore((state) => state.openCreateModal);
  const openCreateTemplateModal = useWorkspaceStore((state) => state.openCreateTemplateModal);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={label ?? t('button.tooltip')} onClick={() => navigate('/workspace')}>
        <Layers />
        <span>{label ?? t('button.label')}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={tCommon('sidebar.moreActions', { name: t('button.label') })}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start'>
          <DropdownMenuItem onClick={() => openCreateModal()} className='cursor-pointer'>
            <Plus className='mr-2 h-4 w-4' />
            {t('button.menu.createWorkspace')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openCreateTemplateModal} className='cursor-pointer'>
            <FileText className='mr-2 h-4 w-4' />
            {t('button.menu.createTemplate')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
});
