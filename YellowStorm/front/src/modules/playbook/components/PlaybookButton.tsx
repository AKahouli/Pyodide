import { useLocation, useNavigate } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function PlaybookButton({ label }: { label?: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useModuleTranslation('playbook');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={label ?? t('sidebar.playbooks')} isActive={pathname === '/playbooks' || pathname.startsWith('/playbooks/')} onClick={() => navigate('/playbooks')}>
        <Workflow />
        <span>{label ?? t('sidebar.playbooks')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
