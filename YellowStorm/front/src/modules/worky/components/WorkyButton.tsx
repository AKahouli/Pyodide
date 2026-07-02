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
            className='px-1 py-0 text-[9px] font-semibold leading-tight border-primary/40 text-primary/70'
          >
            BETA
          </Badge>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
