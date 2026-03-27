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
          <Badge variant="outline" className="px-1 py-0 text-[9px] font-semibold leading-tight border-primary/40 text-primary/70">
            BETA
          </Badge>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
