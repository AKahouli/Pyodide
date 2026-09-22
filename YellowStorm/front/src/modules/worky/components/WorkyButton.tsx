import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function WorkyButton({ label }: { label?: string }): JSX.Element {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('worky');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={label ?? t('nav.worky.tooltip')} onClick={() => navigate('/worky')}>
        <Sparkles />
        <span>{label ?? t('nav.worky')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
