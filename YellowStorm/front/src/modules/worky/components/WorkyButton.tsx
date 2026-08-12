import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';

export function WorkyButton(): JSX.Element {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('worky');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('nav.worky.tooltip')} onClick={() => navigate('/worky')}>
        <Sparkles />
        <span className='flex items-center gap-1.5'>
          {t('nav.worky')}
          <Badge
            variant='outline'
            className='border-sidebar-border bg-sidebar-accent px-1 py-0 text-[10px] font-semibold leading-tight text-sidebar-accent-foreground'
          >
            BETA
          </Badge>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
