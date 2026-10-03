import { useEffect, useId, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { ComputedFieldMethod, ComputedFieldRule, ComputedFieldTransform, ComputedPreviewResult } from '../../types';
import { FormField, INPUT_COMPACT } from '../form/FormParts';

export const COMPUTED_TRANSFORMS: ComputedFieldTransform[] = ['none', 'trim', 'upper', 'lower', 'date_iso', 'year', 'number'];
const FILE_INPUT = '__file';
const MAX_SAMPLES = 20;

/** What a new computed field starts with: the file name, cut at each `_`. */
export function newComputedRule(): ComputedFieldRule {
  return { input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: 1, stripExtension: true, transform: 'none' };
}

/** Keeps only the settings of the chosen method, so the payload matches what the runtime expects. */
export function computedPayload(rule: ComputedFieldRule): ComputedFieldRule {
  const base: ComputedFieldRule = { input: rule.input, method: rule.method, transform: rule.transform ?? 'none' };
  if (rule.input.kind === 'file') base.stripExtension = rule.stripExtension ?? true;
  if (rule.method === 'split') return { ...base, delimiter: rule.delimiter, part: rule.part };
  if (rule.method === 'between') return { ...base, ...(rule.after ? { after: rule.after } : {}), ...(rule.before ? { before: rule.before } : {}) };
  return { ...base, pattern: rule.pattern, ...(rule.template?.trim() ? { template: rule.template } : {}) };
}

/** The translation key of what is missing or wrong, or null when the rule can be saved. */
export function computedProblem(rule?: ComputedFieldRule, otherFields: string[] = []): string | null {
  if (!rule) return 'mapping.computed.problem.missing';
  if (rule.input.kind === 'field' && !otherFields.includes(rule.input.name)) return 'mapping.computed.problem.input';
  if (rule.method === 'split') {
    if (!rule.delimiter || rule.delimiter.length > 10) return 'mapping.computed.problem.delimiter';
    if (!Number.isInteger(rule.part) || !rule.part || Math.abs(rule.part) > 20) return 'mapping.computed.problem.part';
  }
  if (rule.method === 'between') {
    if (!rule.after && !rule.before) return 'mapping.computed.problem.between';
    if ((rule.after?.length ?? 0) > 50 || (rule.before?.length ?? 0) > 50) return 'mapping.computed.problem.betweenLength';
  }
  if (rule.method === 'regex') {
    if (!rule.pattern?.trim() || rule.pattern.length > 200) return 'mapping.computed.problem.pattern';
    try { new RegExp(rule.pattern); } catch { return 'mapping.computed.problem.pattern'; }
    if (!/\((?!\?(?:[:=!]|<[=!]))/.test(rule.pattern)) return 'mapping.computed.problem.group';
    if ((rule.template?.length ?? 0) > 100) return 'mapping.computed.problem.template';
  }
  return null;
}

export function ComputedFieldEditor({ modelId, fieldLabel, rule, onChange, fields, fileSamples, fieldSamples }: Readonly<{
  modelId: string;
  fieldLabel: string;
  rule: ComputedFieldRule;
  onChange: (rule: ComputedFieldRule) => void;
  /** The other fields of this mapping it can be taken from. */
  fields: Array<{ key: string; label: string }>;
  fileSamples: string[];
  /** Values read for each field in the last document preview, when there is one. */
  fieldSamples?: Record<string, string[]>;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const id = useId();
  const [advanced, setAdvanced] = useState(rule.method === 'regex');
  const [preview, setPreview] = useState<{ results?: ComputedPreviewResult[]; error?: string; loading?: boolean }>({});
  const update = (patch: Partial<ComputedFieldRule>) => onChange({ ...rule, ...patch });
  const fromEnd = (rule.part ?? 1) < 0;
  const position = Math.abs(rule.part ?? 1) || 1;
  const fromFile = rule.input.kind === 'file';
  const samples = (fromFile ? fileSamples : fieldSamples?.[rule.input.name] ?? []).filter(Boolean).slice(0, MAX_SAMPLES);
  const problem = computedProblem(rule, fields.map((field) => field.key));
  const payload = JSON.stringify(computedPayload(rule));
  const sampleKey = samples.join('\n');

  useEffect(() => {
    if (problem || !samples.length) { setPreview({}); return; }
    let cancelled = false;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      semanticModelApi.previewComputedField(modelId, { computed: JSON.parse(payload) as ComputedFieldRule, samples })
        .then((result) => { if (!cancelled) setPreview({ results: result.results }); })
        .catch((error) => { if (!cancelled) setPreview({ error: parseApiError(error).message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, payload, sampleKey, problem]);

  const setMethod = (method: ComputedFieldMethod) => update(method === 'split' ? { method, delimiter: rule.delimiter ?? '_', part: rule.part ?? 1 } : { method });

  return <div className='space-y-4 rounded-lg border p-3 text-xs' aria-label={t('mapping.computed.editorFor', { field: fieldLabel })} role='group'>
    <FormField label={t('mapping.computed.input')}>
      <Select value={fromFile ? FILE_INPUT : rule.input.name} onValueChange={(value) => update({ input: value === FILE_INPUT ? { kind: 'file', name: 'document_name' } : { kind: 'field', name: value } })}>
        <SelectTrigger className={INPUT_COMPACT} aria-label={t('mapping.computed.input')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={FILE_INPUT}>{t('mapping.computed.fileName')}</SelectItem>
          {fields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {fromFile && <label className='flex items-center gap-2 pt-0.5'>
        <input type='checkbox' checked={rule.stripExtension ?? true} onChange={(event) => update({ stripExtension: event.target.checked })} />{t('mapping.computed.stripExtension')}
      </label>}
    </FormField>

    <FormField label={t('mapping.computed.method')} help={t(`mapping.computed.help.${rule.method}`)}>
      <div role='tablist' className='flex flex-wrap items-center gap-1'>
        {(['split', 'between', ...(advanced ? ['regex' as const] : [])] as ComputedFieldMethod[]).map((method) =>
          <button key={method} type='button' role='tab' aria-selected={rule.method === method} onClick={() => setMethod(method)}
            className={cn('rounded-full border px-2.5 py-1', rule.method === method ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>{t(`mapping.computed.methods.${method}`)}</button>)}
        <button type='button' className='ml-auto text-[11px] text-muted-foreground underline' onClick={() => { if (advanced && rule.method === 'regex') setMethod('split'); setAdvanced(!advanced); }}>
          {advanced ? t('mapping.computed.hideAdvanced') : t('mapping.computed.showAdvanced')}
        </button>
      </div>
      {rule.method === 'split' && <div className='flex flex-wrap items-end gap-3 pt-1.5'>
        <FormField label={t('mapping.computed.delimiter')} htmlFor={`${id}-delimiter`}>
          <Input id={`${id}-delimiter`} className={cn(INPUT_COMPACT, 'w-24')} maxLength={10} value={rule.delimiter ?? ''} onChange={(event) => update({ delimiter: event.target.value })} aria-label={t('mapping.computed.delimiter')} /></FormField>
        <FormField label={t('mapping.computed.position')} htmlFor={`${id}-position`}>
          <Input id={`${id}-position`} className={cn(INPUT_COMPACT, 'w-20')} type='number' min={1} max={20} value={position} aria-label={t('mapping.computed.position')}
            onChange={(event) => { const value = Number.parseInt(event.target.value, 10) || 0; update({ part: fromEnd ? -value : value }); }} /></FormField>
        <label className='flex h-8 items-center gap-2'>
          <input type='checkbox' checked={fromEnd} onChange={(event) => update({ part: event.target.checked ? -position : position })} />{t('mapping.computed.fromEnd')}
        </label>
      </div>}
      {rule.method === 'between' && <div className='flex flex-wrap gap-3 pt-1.5'>
        <FormField label={t('mapping.computed.after')} htmlFor={`${id}-after`}>
          <Input id={`${id}-after`} className={cn(INPUT_COMPACT, 'w-36')} maxLength={50} value={rule.after ?? ''} onChange={(event) => update({ after: event.target.value })} aria-label={t('mapping.computed.after')} /></FormField>
        <FormField label={t('mapping.computed.before')} htmlFor={`${id}-before`}>
          <Input id={`${id}-before`} className={cn(INPUT_COMPACT, 'w-36')} maxLength={50} value={rule.before ?? ''} onChange={(event) => update({ before: event.target.value })} aria-label={t('mapping.computed.before')} /></FormField>
      </div>}
      {rule.method === 'regex' && <div className='space-y-3 pt-1.5'>
        <FormField label={t('mapping.computed.pattern')} htmlFor={`${id}-pattern`}>
          <Input id={`${id}-pattern`} className={cn(INPUT_COMPACT, 'font-mono')} maxLength={200} value={rule.pattern ?? ''} onChange={(event) => update({ pattern: event.target.value })} aria-label={t('mapping.computed.pattern')} /></FormField>
        <FormField label={t('mapping.computed.template')} htmlFor={`${id}-template`}>
          <Input id={`${id}-template`} className={cn(INPUT_COMPACT, 'font-mono')} maxLength={100} value={rule.template ?? ''} onChange={(event) => update({ template: event.target.value })} placeholder='{1}' aria-label={t('mapping.computed.template')} /></FormField>
      </div>}
    </FormField>

    <FormField label={t('mapping.computed.transform')}>
      <Select value={rule.transform ?? 'none'} onValueChange={(value: ComputedFieldTransform) => update({ transform: value })}>
        <SelectTrigger className={cn(INPUT_COMPACT, 'w-48')} aria-label={t('mapping.computed.transform')}><SelectValue /></SelectTrigger>
        <SelectContent>{COMPUTED_TRANSFORMS.map((transform) => <SelectItem key={transform} value={transform}>{t(`mapping.computed.transforms.${transform}`)}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>

    {problem && <p role='alert' className='flex gap-1.5 text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{t(problem as never)}</p>}
    {!problem && <div className='space-y-1 border-t pt-3'>
      <p className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>{t('mapping.computed.preview')}{preview.loading && <Loader2 className='h-3 w-3 animate-spin' />}</p>
      {!samples.length && <p className='text-muted-foreground'>{t(fromFile ? 'mapping.computed.noFiles' : 'mapping.computed.noFieldValues')}</p>}
      {preview.error && <p role='alert' className='flex gap-1.5 text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{preview.error}</p>}
      {preview.results?.map((result, index) => <div key={`${result.input}-${index}`} className='flex flex-wrap items-center gap-1.5'>
        <span className='truncate text-muted-foreground'>{result.input ?? samples[index] ?? '—'}</span><ArrowRight className='h-3 w-3 shrink-0' />
        {result.value !== null ? <span className='font-medium'>{result.value}</span> : <span className='text-amber-700 dark:text-amber-400'>{t(`mapping.reading.reason.${result.reason}`, { values: '', detail: '' })}</span>}
      </div>)}
    </div>}
  </div>;
}
