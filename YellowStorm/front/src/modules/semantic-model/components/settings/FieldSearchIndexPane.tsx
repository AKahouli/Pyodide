import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  FIELD_OVERRIDE_FIELDS, SEARCH_INDEX_DEFAULTS, SEARCH_SETTINGS_QUERY_KEY, cleanFieldIndex, effectiveIndex, fieldOverrideProblems,
  indexRange, outOfRange, searchSettingsApi, type FieldSearchIndex, type SearchIndexSettings,
} from '../../searchSettings';
import { INPUT_COMPACT } from '../form/FormParts';
import { HelpTip } from '../mapping/RuleControls';
import { ResetFieldButton } from './SettingNumberField';

type Passages = 'global' | 'yes' | 'no';

/** The global index values every model reader sees; the built-ins when they cannot be read. */
function useGlobalIndex(): SearchIndexSettings {
  const query = useQuery({ queryKey: SEARCH_SETTINGS_QUERY_KEY, queryFn: () => searchSettingsApi.getEffective(), staleTime: 60_000, retry: false });
  return query.data?.index ? { ...SEARCH_INDEX_DEFAULTS, ...query.data.index } : effectiveIndex({});
}

/**
 * A text field's own search index settings: whether its full text is cut into passages, and how.
 * Folded by default; its header sums up what differs from the global settings.
 */
export function FieldSearchIndexPane({ value, onChange, fieldLabel, disabled }: Readonly<{
  value?: FieldSearchIndex;
  onChange: (next?: FieldSearchIndex) => void;
  fieldLabel: string;
  disabled?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const id = `search-index-${fieldLabel.replaceAll(/\W+/g, '-')}`;
  const current = cleanFieldIndex(value);
  const parts = [
    ...FIELD_OVERRIDE_FIELDS.filter((key) => current?.[key] !== undefined).map((key) => t(`searchSettings.field.part.${key}`, { value: current![key]!.toLocaleString() })),
    ...(current?.passages === undefined ? [] : [t(current.passages ? 'searchSettings.field.part.passagesOn' : 'searchSettings.field.part.passagesOff')]),
  ];
  const summary = parts.length ? t('searchSettings.field.custom', { parts: parts.join(', ') }) : t('searchSettings.field.global');

  return <div className='rounded-lg border border-dashed'>
    <button type='button' className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/50'
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown className='h-3.5 w-3.5 shrink-0' /> : <ChevronRight className='h-3.5 w-3.5 shrink-0' />}
      <span className='shrink-0 font-medium text-foreground'>{t('searchSettings.field.title')}</span>
      <span className='min-w-0 truncate'>{summary}</span>
    </button>
    {open && <FieldSearchIndexBody id={id} value={current} onChange={onChange} fieldLabel={fieldLabel} disabled={disabled} />}
  </div>;
}

function FieldSearchIndexBody({ id, value, onChange, fieldLabel, disabled }: Readonly<{
  id: string; value?: FieldSearchIndex; onChange: (next?: FieldSearchIndex) => void; fieldLabel: string; disabled?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const globalIndex = useGlobalIndex();
  const problem = fieldOverrideProblems(value, globalIndex);
  const set = <K extends keyof FieldSearchIndex>(key: K, next: FieldSearchIndex[K] | undefined) => onChange(cleanFieldIndex({ ...value, [key]: next }));
  const passages: Passages = value?.passages === undefined ? 'global' : value.passages ? 'yes' : 'no';
  const choices: Passages[] = ['global', 'yes', 'no'];

  return <div id={id} className='space-y-2.5 border-t px-2.5 py-2 text-[11px]'>
    <div className='space-y-1'>
      <div className='flex items-center gap-1'>
        <span className='font-medium text-muted-foreground' id={`${id}-passages`}>{t('searchSettings.field.passages')}</span>
        <HelpTip text={t('searchSettings.field.passagesTip')} />
      </div>
      <div role='radiogroup' aria-labelledby={`${id}-passages`} className='inline-flex rounded-md border p-0.5'>
        {choices.map((choice) => <button key={choice} type='button' role='radio' aria-checked={passages === choice} disabled={disabled}
          className={cn('rounded px-2 py-0.5 text-[11px]', passages === choice ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => set('passages', choice === 'global' ? undefined : choice === 'yes')}>
          {t(`searchSettings.field.passages_${choice}`)}
        </button>)}
      </div>
    </div>
    <div className='grid gap-x-3 gap-y-2 sm:grid-cols-3'>
      {FIELD_OVERRIDE_FIELDS.map((key) => {
        const range = indexRange(key, globalIndex);
        const current = value?.[key];
        const wrong = outOfRange(current, range);
        const label = t(`searchSettings.index.${key}`);
        const inputId = `${id}-${key}`;
        return <div key={key} className='space-y-1'>
          <div className='flex items-center gap-1'>
            <Label htmlFor={inputId} className='text-[11px] font-medium text-muted-foreground'>{label}</Label>
            <HelpTip text={t(`searchSettings.index.${key}Tip`)} />
          </div>
          <div className='flex items-center gap-1'>
            <Input id={inputId} type='number' min={range.min} max={range.max} className={cn(INPUT_COMPACT, 'text-xs')} aria-invalid={wrong} disabled={disabled}
              aria-label={t('searchSettings.field.inputFor', { setting: label, field: fieldLabel })}
              value={current ?? ''} placeholder={String(globalIndex[key])}
              onChange={(event) => set(key, event.target.value === '' ? undefined : Number(event.target.value))} />
            {current !== undefined && <ResetFieldButton compact label={label} disabled={disabled} onClick={() => set(key, undefined)} />}
          </div>
          {wrong && <p className='text-destructive'>{t('mapping.ai.range', { min: range.min.toLocaleString(), max: range.max.toLocaleString() })}</p>}
        </div>;
      })}
    </div>
    {problem && <p role='alert' className='text-destructive'>{t(problem)}</p>}
    <p className='text-muted-foreground'>{t('searchSettings.field.note')}</p>
  </div>;
}
