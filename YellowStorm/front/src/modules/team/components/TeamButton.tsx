import { Users, MoreHorizontal, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';

export function TeamButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('team');
  const goToTeams = () => navigate('/teams');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.teams')} onClick={goToTeams}>
        <Users />
        <span>{t('button.teams')}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start'>
          <DropdownMenuItem onClick={goToTeams} className='cursor-pointer'>
            <Settings className='mr-2 h-4 w-4' />
            {t('button.manageTeams')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
