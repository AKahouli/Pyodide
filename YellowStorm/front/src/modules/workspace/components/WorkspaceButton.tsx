/**
 * Workspace Button Component
 * Sidebar button with 3-dot menu for quick actions
 */

import { memo } from 'react';
import { Layers, MoreHorizontal, Plus, FileText } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuAction } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkspaceStore } from '../store';
import { useWorkspaceStoreTranslator } from '../hooks/useWorkspaceStoreTranslator';

export const WorkspaceButton = memo(function WorkspaceButton() {
  const { t } = useModuleTranslation('workspace');
  useWorkspaceStoreTranslator();
  const openModal = useWorkspaceStore((state) => state.openModal);
  const openCreateModal = useWorkspaceStore((state) => state.openCreateModal);
  const openCreateTemplateModal = useWorkspaceStore((state) => state.openCreateTemplateModal);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.tooltip')} onClick={openModal}>
        <Layers />
        <span>{t('button.label')}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start'>
          <DropdownMenuItem onClick={openCreateModal} className='cursor-pointer'>
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
