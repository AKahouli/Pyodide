import { Network } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function SemanticModelButton({ label }: { label?: string }) {
  const {t}=useModuleTranslation('semantic-model');const navigate=useNavigate();const location=useLocation();
  return <SidebarMenuItem><SidebarMenuButton tooltip={label ?? t('navigation.tooltip')} isActive={location.pathname.startsWith('/semantic-models')} onClick={()=>navigate('/semantic-models')}><Network /><span>{label ?? t('navigation.label')}</span></SidebarMenuButton></SidebarMenuItem>;
}
