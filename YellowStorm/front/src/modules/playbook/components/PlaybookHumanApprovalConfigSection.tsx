import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { HumanApprovalConfig } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  value: HumanApprovalConfig;
  onChange: (next: HumanApprovalConfig) => void;
  disabled?: boolean;
}

export function PlaybookHumanApprovalConfigSection({ value, onChange, disabled }: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>{t('humanApprovalEditor.promptTemplate')}</Label>
        <Textarea
          value={value.promptTemplate}
          onChange={(e) => onChange({ ...value, promptTemplate: e.target.value })}
          placeholder={t('humanApprovalEditor.promptTemplatePlaceholder')}
          rows={4}
          maxLength={5000}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">{t('humanApprovalEditor.promptTemplateHint')}</p>
      </div>

      <div className="space-y-2">
        <Label>{t('humanApprovalEditor.timeoutSeconds')}</Label>
        <Input
          type="number"
          min={0}
          max={86400}
          value={value.timeoutSeconds ?? ''}
          onChange={(e) => {
            const val = e.target.value === '' ? undefined : Number(e.target.value);
            onChange({ ...value, timeoutSeconds: val });
          }}
          disabled={disabled}
          placeholder={t('humanApprovalEditor.noTimeout')}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">{t('humanApprovalEditor.timeoutHint')}</p>
      </div>
    </div>
  );
}
