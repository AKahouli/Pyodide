import { Users2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function GroupsButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('groups');
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.groups')} onClick={() => navigate('/groups')}>
        <Users2 />
        <span>{t('button.groups')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
