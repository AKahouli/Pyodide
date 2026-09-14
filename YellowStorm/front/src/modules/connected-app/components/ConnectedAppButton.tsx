import { useNavigate } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function ConnectedAppButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('connected-app');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.tooltip')} onClick={() => navigate('/connected-apps')}>
        <Plug />
        <span>{t('button.label')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
