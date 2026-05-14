import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';

export function PlaybookDataBindingSection() {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t('dataBindingEditor.title')}</h4>
        <Badge variant="outline" className="text-xs">
          {t('dataBindingEditor.comingSoon')}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t('dataBindingEditor.description')}</p>
    </div>
  );
}
