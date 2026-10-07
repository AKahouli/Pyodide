import { memo } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export const EvaluationLogicalSearchButton = memo(function EvaluationLogicalSearchButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('evaluation-logical-search');
  const goToPage = () => navigate('/evaluation-logical-search');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.label')} onClick={goToPage}>
        <ClipboardCheck />
        <span>{t('button.label')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});