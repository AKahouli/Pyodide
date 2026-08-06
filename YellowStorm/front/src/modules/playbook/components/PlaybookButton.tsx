import { useNavigate } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';

export function PlaybookButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('sidebar.playbooks')} onClick={() => navigate('/playbooks')}>
        <Workflow />
        <span className="flex items-center gap-1.5">
          {t('sidebar.playbooks')}
          <Badge variant="outline" className="border-sidebar-border bg-sidebar-accent px-1 py-0 text-[10px] font-semibold leading-tight text-sidebar-accent-foreground">
            BETA
          </Badge>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
