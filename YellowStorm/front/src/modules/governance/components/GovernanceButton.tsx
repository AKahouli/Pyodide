import { memo } from 'react';
import { MoreHorizontal, Settings, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';

export const GovernanceButton = memo(function GovernanceButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('governance');
  const { t: tCommon } = useModuleTranslation('common');
  const goToGovernance = () => navigate('/governance');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.label')} onClick={goToGovernance}>
        <ShieldCheck />
        <span>{t('button.label')}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={tCommon('sidebar.moreActions', { name: t('button.label') })}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start'>
          <DropdownMenuItem onClick={goToGovernance} className='cursor-pointer'>
            <Settings className='mr-2 h-4 w-4' />
            {t('button.manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
});
