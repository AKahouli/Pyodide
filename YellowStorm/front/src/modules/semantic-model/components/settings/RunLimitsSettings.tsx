import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { HelpTip } from '../mapping/RuleControls';
import type { RunLimits } from '../../types';

/** Built-in limits and the ranges the back end and the runtime accept. */
export const RUN_LIMIT_FIELDS: ReadonlyArray<{ key: keyof RunLimits; builtIn: number; min: number; max: number }> = [
  { key: 'maxRunSources', builtIn: 5000, min: 1, max: 50000 },
  { key: 'maxRecordsPerSource', builtIn: 5000, min: 100, max: 200000 },
  { key: 'maxRecordsPerRun', builtIn: 10000, min: 100, max: 200000 },
  { key: 'maxValuesPerRun', builtIn: 50000, min: 1000, max: 2000000 },
];

function invalid(key: keyof RunLimits, value: number | undefined): boolean {
  const field = RUN_LIMIT_FIELDS.find((candidate) => candidate.key === key)!;
  return value !== undefined && (!Number.isInteger(value) || value < field.min || value > field.max);
}

/** Admin > Semantic models: how much one run may read and keep, for every model. */
export function RunLimitsSettings() {
  const { t } = useModuleTranslation('semantic-model');
  const [configured, setConfigured] = useState<Partial<RunLimits>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    semanticModelApi.getAdminRunLimits()
      .then((limits) => setConfigured(limits.configured))
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }));
  }, [t]);

  const hasProblem = RUN_LIMIT_FIELDS.some(({ key }) => invalid(key, configured[key]));
  const save = async () => {
    setSaving(true);
    try {
      setConfigured((await semanticModelApi.updateAdminRunLimits(configured)).configured);
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  return <section className='space-y-4 rounded-lg border p-5'>
    <div className='space-y-1'>
      <h2 className='flex items-center gap-2 font-semibold'><Gauge className='h-4 w-4' />{t('settings.runLimits.title')}</h2>
      <p className='text-sm text-muted-foreground'>{t('settings.runLimits.description')}</p>
    </div>
    <div className='grid gap-3 sm:grid-cols-2'>
      {RUN_LIMIT_FIELDS.map(({ key, builtIn, min, max }) => {
        const value = configured[key];
        const wrong = invalid(key, value);
        return <div key={key} className='space-y-1'>
          <div className='flex items-center gap-1'>
            <Label htmlFor={`run-limit-${key}`} className='text-xs'>{t(`settings.runLimits.${key}`)}</Label>
            <HelpTip text={t(`settings.runLimits.${key}Tip`)} />
          </div>
          <Input id={`run-limit-${key}`} type='number' min={min} max={max} className='h-8 text-xs' aria-invalid={wrong}
            value={value ?? ''} placeholder={String(builtIn)}
            onChange={(event) => {
              const next = { ...configured };
              if (event.target.value === '') delete next[key]; else next[key] = Number(event.target.value);
              setConfigured(next);
            }} />
          <p className={cn('text-[11px]', wrong ? 'text-destructive' : 'text-muted-foreground')}>
            {wrong
              ? t('mapping.ai.range', { min: min.toLocaleString(), max: max.toLocaleString() })
              : t('settings.builtIn', { value: builtIn.toLocaleString() })}
          </p>
        </div>;
      })}
    </div>
    <p className='text-xs text-muted-foreground'>{t('settings.runLimits.note')}</p>
    <div className='flex flex-wrap items-center gap-2'>
      <Button className='bg-foreground text-background hover:bg-foreground/90' onClick={() => void save()} disabled={saving || hasProblem}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
      {Object.keys(configured).length > 0 && <Button variant='ghost' onClick={() => setConfigured({})}>{t('settings.reset')}</Button>}
    </div>
  </section>;
}
