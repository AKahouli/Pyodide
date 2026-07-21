import { useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function AppMarketplaceButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('app-marketplace');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.tooltip')} onClick={() => navigate('/app-market')}>
        <Store />
        <span>{t('button.label')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
