import { Label } from '@/components/ui/label';
import { ReasoningEffortSelector } from '@/components/ai-elements/reasoning-effort-selector';
import type { Model } from '@/modules/models';
import { useModuleTranslation } from '@/modules/localization';

interface AgentReasoningEffortFieldProps {
  model: Model | undefined;
  value: string;
  onValueChange: (value: string) => void;
}

export function AgentReasoningEffortField({ model, value, onValueChange }: AgentReasoningEffortFieldProps) {
  const { t } = useModuleTranslation('agent');
  const efforts = model?.supportsReasoning ? (model.reasoning?.efforts ?? []) : [];
  const disabled = efforts.length === 0;

  return (
    <div className='space-y-2'>
      <Label>{t('createEdit.fields.reasoningEffort')}</Label>
      <ReasoningEffortSelector
        efforts={efforts}
        value={value || undefined}
        onValueChange={onValueChange}
        label={disabled
          ? t('createEdit.fields.reasoningEffortUnavailable')
          : t('createEdit.fields.reasoningEffort')}
        disabled={disabled}
        fullWidth
      />
      {disabled && (
        <p className='text-xs text-muted-foreground'>
          {t('createEdit.fields.reasoningEffortUnavailableDescription')}
        </p>
      )}
    </div>
  );
}
