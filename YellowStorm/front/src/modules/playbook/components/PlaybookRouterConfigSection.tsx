import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import type { RouterConfig } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  value: RouterConfig;
  onChange: (next: RouterConfig) => void;
  disabled?: boolean;
}

export function PlaybookRouterConfigSection({ value, onChange, disabled }: Props) {
  const { t } = useModuleTranslation('playbook');

  const addLabel = () => {
    const next = [...value.outputLabels, `label_${value.outputLabels.length + 1}`];
    onChange({ ...value, outputLabels: next });
  };

  const removeLabel = (idx: number) => {
    const next = value.outputLabels.filter((_, i) => i !== idx);
    onChange({ ...value, outputLabels: next });
  };

  const updateLabel = (idx: number, label: string) => {
    const next = [...value.outputLabels];
    next[idx] = label;
    onChange({ ...value, outputLabels: next });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('routerEditor.outputLabels')}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={addLabel}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('routerEditor.addLabel')}
          </Button>
        </div>
        <div className="space-y-1.5">
          {value.outputLabels.map((label, idx) => (
            <div key={`${label}-${idx}`} className="flex items-center gap-2">
              <Input
                value={label}
                onChange={(e) => updateLabel(idx, e.target.value)}
                disabled={disabled || label === '__error__'}
                className="h-8 text-xs"
              />
              {label !== '__error__' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeLabel(idx)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('routerEditor.maxIterations')}</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={value.maxIterations}
          onChange={(e) => onChange({ ...value, maxIterations: Math.max(1, Number(e.target.value || 1)) })}
          disabled={disabled}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">{t('routerEditor.maxIterationsHint')}</p>
      </div>
    </div>
  );
}
