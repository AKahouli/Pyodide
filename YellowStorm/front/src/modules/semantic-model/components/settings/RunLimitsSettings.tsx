import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Gauge, Mail, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { FormField, INPUT } from '../form/FormParts';
import type { RunLimits } from '../../types';
import { SettingsPane } from './SettingsPane';

type RunLimitGroup = 'size' | 'ai' | 'archive' | 'rebuild';

/** Built-in limits and the ranges the back end and the runtime accept. */
export const RUN_LIMIT_FIELDS: ReadonlyArray<{ key: keyof RunLimits; builtIn: number; min: number; max: number; group: RunLimitGroup }> = [
  { key: 'maxRunSources', builtIn: 5000, min: 1, max: 50000, group: 'size' },
  { key: 'maxRecordsPerSource', builtIn: 5000, min: 100, max: 500000, group: 'size' },
  { key: 'maxRecordsPerRun', builtIn: 10000, min: 100, max: 500000, group: 'size' },
  { key: 'maxValuesPerRun', builtIn: 50000, min: 1000, max: 5000000, group: 'size' },
  { key: 'maxAiRowsPerSource', builtIn: 500, min: 0, max: 200000, group: 'ai' },
  { key: 'maxAiParallelCalls', builtIn: 8, min: 1, max: 32, group: 'ai' },
  { key: 'archiveTimeoutSeconds', builtIn: 900, min: 60, max: 7200, group: 'archive' },
  { key: 'parserMemoryMb', builtIn: 512, min: 256, max: 16384, group: 'archive' },
  { key: 'purgeTimeoutSeconds', builtIn: 300, min: 30, max: 3600, group: 'rebuild' },
];

const GROUPS: Record<RunLimitGroup, { id: string; title: string; description: string; icon: ReactNode }> = {
  size: { id: 'run-size', title: 'settings.runLimits.title', description: 'settings.runLimits.description', icon: <Gauge className='h-4 w-4 text-muted-foreground' aria-hidden /> },
  ai: { id: 'ai-calls', title: 'settings.aiCalls.title', description: 'settings.aiCalls.description', icon: <Bot className='h-4 w-4 text-muted-foreground' aria-hidden /> },
  archive: { id: 'email-archives', title: 'settings.archives.title', description: 'settings.archives.description', icon: <Mail className='h-4 w-4 text-muted-foreground' aria-hidden /> },
  rebuild: { id: 'rebuild', title: 'settings.rebuild.title', description: 'settings.rebuild.description', icon: <RotateCcw className='h-4 w-4 text-muted-foreground' aria-hidden /> },
};

const NOTES: Record<RunLimitGroup, 'settings.runLimits.note' | 'settings.aiCalls.note' | 'settings.archives.note' | 'settings.rebuild.note'> = {
  size: 'settings.runLimits.note', ai: 'settings.aiCalls.note', archive: 'settings.archives.note', rebuild: 'settings.rebuild.note',
};

function invalid(key: keyof RunLimits, value: number | undefined): boolean {
  const field = RUN_LIMIT_FIELDS.find((candidate) => candidate.key === key)!;
  return value !== undefined && (!Number.isInteger(value) || value < field.min || value > field.max);
}

/**
 * Admin > Semantic models: how much one run may read and keep (`size`), how it calls the AI (`ai`), how long
 * it reads a mail archive (`archive`) and how long "Start over from scratch" may take (`rebuild`), for every model.
 * All groups are saved in the same run limits: a pane saves only its own fields.
 */
export function RunLimitsSettings({ group = 'size' }: Readonly<{ group?: RunLimitGroup }>) {
  const { t } = useModuleTranslation('semantic-model');
  const fields = RUN_LIMIT_FIELDS.filter((field) => field.group === group);
  const [configured, setConfigured] = useState<Partial<RunLimits>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    semanticModelApi.getAdminRunLimits()
      .then((limits) => setConfigured(limits.configured))
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }));
  }, [t]);

  const own = (limits: Partial<RunLimits>) => Object.fromEntries(fields
    .filter(({ key }) => limits[key] !== undefined).map(({ key }) => [key, limits[key]])) as Partial<RunLimits>;
  const hasProblem = fields.some(({ key }) => invalid(key, configured[key]));
  const save = async () => {
    setSaving(true);
    try {
      // The other pane may have saved since this one loaded: keep its fields as they are now.
      const current = (await semanticModelApi.getAdminRunLimits()).configured;
      const others = Object.fromEntries(Object.entries(current)
        .filter(([key]) => !fields.some((field) => field.key === key))) as Partial<RunLimits>;
      setConfigured((await semanticModelApi.updateAdminRunLimits({ ...others, ...own(configured) })).configured);
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };
  const meta = GROUPS[group];
  const summary = fields.map(({ key, builtIn }) => `${t(`settings.runLimits.${key}`)} ${(configured[key] ?? builtIn).toLocaleString()}`).join(' · ');

  return <SettingsPane id={meta.id} title={t(meta.title as 'settings.runLimits.title')} help={t(meta.description as 'settings.runLimits.description')} icon={meta.icon} summary={summary}>
    <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2'>
      {fields.map(({ key, builtIn, min, max }) => {
        const value = configured[key];
        const wrong = invalid(key, value);
        return <FormField key={key} label={t(`settings.runLimits.${key}`)} help={t(`settings.runLimits.${key}Tip`)} htmlFor={`run-limit-${key}`}>
          <Input id={`run-limit-${key}`} type='number' min={min} max={max} className={INPUT} aria-invalid={wrong}
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
        </FormField>;
      })}
    </div>
    <p className='text-xs text-muted-foreground'>{t(NOTES[group])}</p>
    <div className='flex flex-wrap items-center gap-2'>
      <Button className='bg-foreground text-background hover:bg-foreground/90' onClick={() => void save()} disabled={saving || hasProblem}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
      {Object.keys(own(configured)).length > 0 && <Button variant='ghost' onClick={() => setConfigured({ ...configured, ...Object.fromEntries(fields.map(({ key }) => [key, undefined])) })}>{t('settings.reset')}</Button>}
    </div>
  </SettingsPane>;
}
