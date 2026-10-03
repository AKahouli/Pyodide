import { useEffect, useId, useState } from 'react';
import { AlertTriangle, ArrowRight, FileText, Loader2, Play, Split } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { ComputedFieldInput, ComputedFieldMethod, ComputedFieldRule, ComputedFieldTransform, ComputedPreviewResult } from '../../types';
import { FormField, INPUT_COMPACT, ROW_LIST } from '../form/FormParts';
import { RuleSection, useOpenSections } from './RuleControls';
import { CleanupSection, KeepSection, patternProblem, takeProblem, ValuePatternSection } from './ValueShapeSections';

/**
 * One field's recipe, whatever the source: Take it from → How to cut it → Keep → What the value looks
 * like → Clean-up → Result. A document field is taken from its file name or another field; a sheet
 * field from a column or another field of the same row. Every step runs in the runtime with the same
 * functions for both (app/population/computed_fields.py).
 *
 * The "Take it from" choices are a list per source (`inputOptions`): a later input kind (e.g. an AI
 * reading of a column) adds an option there and, if it needs settings, its own pane after this one.
 */

// The reading rules' clean-ups, then the two only a recipe has.
export const COMPUTED_TRANSFORMS: ComputedFieldTransform[] = ['none', 'trim', 'no_spaces', 'upper', 'lower', 'date_iso', 'year', 'number'];
const MAX_SAMPLES = 20;
// Files, values or rows ticked for the preview until the person picks others.
const DEFAULT_PICKED = 5;
// Above this many, the list gets a filter box.
const FILTER_FROM = 8;
// What the runtime reads of one sample.
const MAX_SAMPLE_CHARS = 1000;
// Problems shown on the “How to cut it” step.
const CUT_PROBLEMS = ['delimiter', 'part', 'between', 'betweenLength', 'pattern', 'group', 'template'];

/** Where a field's recipe takes its value from, and what it can be tried on. */
export type RecipeSource =
  | {
    kind: 'document';
    /** The source's own files (a workspace's, subfolders included), offered to try the rule on. */
    fileSamples: string[];
    /** Values read for each field in the last document preview, when there is one. */
    fieldSamples?: Record<string, string[]>;
  }
  | {
    kind: 'sheet';
    /** Every column of the sheet. */
    columns: string[];
    /** A bounded sample of the sheet's rows (the source analysis), to try the recipe on. */
    rows: Array<Record<string, unknown>>;
    /** The other mapped fields of the row: the column each is read from, and its own recipe if any. */
    fieldInputs: Record<string, { column: string; recipe?: ComputedFieldRule }>;
  };

/** What a new computed document field starts with: the file name, cut at each `_`. */
export function newComputedRule(): ComputedFieldRule {
  return { input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: 1, stripExtension: true, transform: 'none' };
}

/** What a sheet field's recipe starts with: its own column, as it is. */
export function newColumnRecipe(column: string): ComputedFieldRule {
  return { input: { kind: 'column', name: column }, method: 'whole', transform: 'none' };
}

/** How many steps change a sheet field's value; 0 means the column is read as it is (no recipe saved). */
export function recipeStepCount(rule: ComputedFieldRule | undefined, ownColumn: string | null): number {
  if (!rule) return 0;
  return [
    !(rule.input.kind === 'column' && rule.input.name === ownColumn),
    rule.method !== 'whole',
    Boolean(rule.take),
    Boolean(rule.valuePattern?.trim()),
    (rule.transform ?? 'none') !== 'none',
  ].filter(Boolean).length;
}

/** Keeps only the settings of the chosen method, so the payload matches what the runtime expects. */
export function computedPayload(rule: ComputedFieldRule): ComputedFieldRule {
  const base: ComputedFieldRule = { input: rule.input, method: rule.method, transform: rule.transform ?? 'none' };
  if (rule.take) base.take = rule.take;
  if (rule.valuePattern?.trim()) base.valuePattern = rule.valuePattern;
  if (rule.input.kind === 'file') base.stripExtension = rule.stripExtension ?? true;
  if (rule.method === 'whole') return base;
  if (rule.method === 'split') return { ...base, delimiter: rule.delimiter, part: rule.part };
  if (rule.method === 'between') return { ...base, ...(rule.after ? { after: rule.after } : {}), ...(rule.before ? { before: rule.before } : {}) };
  return { ...base, pattern: rule.pattern, ...(rule.template?.trim() ? { template: rule.template } : {}) };
}

/**
 * The translation key of what is missing or wrong, or null when the rule can be saved. `otherFields` are
 * the fields it may be taken from; `columns`, for a sheet, the columns it may read.
 */
export function computedProblem(rule?: ComputedFieldRule, otherFields: string[] = [], columns?: string[]): string | null {
  if (!rule) return 'mapping.computed.problem.missing';
  if (rule.input.kind === 'field' && !otherFields.includes(rule.input.name)) return 'mapping.computed.problem.input';
  if (rule.input.kind === 'column' && columns && !columns.includes(rule.input.name)) return 'mapping.computed.problem.input';
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
  if (takeProblem(rule.take)) return 'mapping.computed.problem.take';
  if ((rule.valuePattern?.length ?? 0) > 200 || patternProblem(rule.valuePattern)) return 'mapping.computed.problem.valuePattern';
  return null;
}

const FILE_INPUT = '__file';
const inputValue = (input: ComputedFieldInput) => input.kind === 'file' ? FILE_INPUT : `${input.kind}:${input.name}`;
function inputFromValue(value: string): ComputedFieldInput {
  if (value === FILE_INPUT) return { kind: 'file', name: 'document_name' };
  const at = value.indexOf(':');
  const kind = value.slice(0, at);
  return { kind: kind === 'column' ? 'column' : 'field', name: value.slice(at + 1) };
}

const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value).slice(0, MAX_SAMPLE_CHARS);

/** Something the recipe can be tried on: a file name, a value read, or a row of the sheet. */
interface PreviewItem { key: string; label: string; input: string }

export function FieldRecipeEditor({ modelId, fieldLabel, rule, onChange, fields, source }: Readonly<{
  modelId: string;
  fieldLabel: string;
  rule: ComputedFieldRule;
  onChange: (rule: ComputedFieldRule) => void;
  /** The other fields of this mapping it can be taken from. */
  fields: Array<{ key: string; label: string }>;
  source: RecipeSource;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const id = useId();
  const sheet = source.kind === 'sheet';
  const [advanced, setAdvanced] = useState(rule.method === 'regex');
  const [preview, setPreview] = useState<{ results?: ComputedPreviewResult[]; error?: string; loading?: boolean }>({});
  const [picked, setPicked] = useState<{ key: string; items: string[] }>({ key: '', items: [] });
  const [filter, setFilter] = useState('');
  const sections = useOpenSections([]);
  const section = (key: string) => ({ id: `${id}-${key}`, open: sections.isOpen(key), onToggle: () => sections.toggle(key) });
  const update = (patch: Partial<ComputedFieldRule>) => onChange({ ...rule, ...patch });
  const fromEnd = (rule.part ?? 1) < 0;
  const position = Math.abs(rule.part ?? 1) || 1;
  const fromFile = rule.input.kind === 'file';

  // “Take it from”: per source; a later input kind (AI on a column) is one more option here.
  const inputOptions: Array<{ value: string; label: string }> = sheet
    ? [...source.columns.map((column) => ({ value: `column:${column}`, label: t('mapping.recipe.columnOption', { column }) })),
      ...fields.map((field) => ({ value: `field:${field.key}`, label: t('mapping.recipe.fieldOption', { field: field.label }) }))]
    : [{ value: FILE_INPUT, label: t('mapping.computed.fileName') }, ...fields.map((field) => ({ value: `field:${field.key}`, label: field.label }))];

  // What it can be tried on.
  const fieldInput = sheet && rule.input.kind === 'field' ? source.fieldInputs[rule.input.name] : undefined;
  const inputRecipe = fieldInput?.recipe && recipeStepCount(fieldInput.recipe, fieldInput.column) > 0 && !computedProblem(fieldInput.recipe, [], source.kind === 'sheet' ? source.columns : undefined)
    ? computedPayload(fieldInput.recipe) : undefined;
  const available: PreviewItem[] = (() => {
    if (source.kind === 'sheet') {
      const column = rule.input.kind === 'column' ? rule.input.name : fieldInput?.column;
      if (!column) return [];
      return source.rows.map((row, index) => {
        const number = typeof row.__sheetRow === 'number' ? row.__sheetRow : index + 2;
        return { key: `row-${index}`, label: t('mapping.recipe.rowLabel', { row: number }), input: cellText(row[column]) };
      });
    }
    const values = fromFile ? source.fileSamples : source.fieldSamples?.[rule.input.name] ?? [];
    return [...new Set(values.filter(Boolean))].map((value) => ({ key: value, label: value, input: value }));
  })();
  const availableKey = available.map((item) => `${item.key}\u0000${item.input}`).join('\n');
  const chosen = picked.key === availableKey
    ? available.filter((item) => picked.items.includes(item.key)).slice(0, MAX_SAMPLES)
    : available.slice(0, DEFAULT_PICKED);
  const chosenKeys = chosen.map((item) => item.key);
  const samples = chosen.map((item) => item.input);
  const togglePicked = (key: string) => {
    let next = chosenKeys;
    if (chosenKeys.includes(key)) next = chosenKeys.filter((other) => other !== key);
    else if (chosenKeys.length < MAX_SAMPLES) next = [...chosenKeys, key];
    setPicked({ key: availableKey, items: next });
  };
  const query = filter.trim().toLocaleLowerCase();
  const listed = query ? available.filter((item) => `${item.label} ${item.input}`.toLocaleLowerCase().includes(query)) : available;
  const problem = computedProblem(rule, fields.map((field) => field.key), sheet ? source.columns : undefined);
  const payload = JSON.stringify(computedPayload(rule));
  const inputRecipeKey = inputRecipe ? JSON.stringify(inputRecipe) : '';
  const sampleKey = samples.join('\n');

  useEffect(() => {
    if (problem || !samples.length) { setPreview({}); return; }
    let cancelled = false;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      semanticModelApi.previewComputedField(modelId, {
        computed: JSON.parse(payload) as ComputedFieldRule, samples,
        ...(inputRecipeKey ? { inputRecipe: JSON.parse(inputRecipeKey) as ComputedFieldRule } : {}),
      })
        .then((result) => { if (!cancelled) setPreview({ results: result.results }); })
        .catch((error) => { if (!cancelled) setPreview({ error: parseApiError(error).message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, payload, sampleKey, problem, inputRecipeKey]);

  const setMethod = (method: ComputedFieldMethod) => update(method === 'split' ? { method, delimiter: rule.delimiter ?? '_', part: rule.part ?? 1 } : { method });
  const inputLabel = (() => {
    if (fromFile) return t('mapping.computed.fileName');
    if (rule.input.kind === 'column') return t('mapping.recipe.columnOption', { column: rule.input.name });
    const label = fields.find((field) => field.key === rule.input.name)?.label ?? rule.input.name;
    return sheet ? t('mapping.recipe.fieldOption', { field: label }) : label;
  })();
  const methodSummary = (() => {
    if (rule.method === 'whole') return t('mapping.recipe.methodSummary.whole');
    if (rule.method === 'split') return t(fromEnd ? 'mapping.computed.methodSummary.splitEnd' : 'mapping.computed.methodSummary.split', { delimiter: rule.delimiter ?? '', position });
    if (rule.method === 'between') {
      if (rule.after && rule.before) return t('mapping.computed.methodSummary.between', { after: rule.after, before: rule.before });
      if (rule.after) return t('mapping.computed.methodSummary.after', { after: rule.after });
      if (rule.before) return t('mapping.computed.methodSummary.before', { before: rule.before });
      return t('mapping.computed.methods.between');
    }
    return t('mapping.computed.methodSummary.regex', { pattern: rule.pattern ?? '' });
  })();
  // A sheet value is often used whole; a document's file name is always cut.
  const methods: ComputedFieldMethod[] = [...(sheet || rule.method === 'whole' ? ['whole' as const] : []), 'split', 'between', ...(advanced ? ['regex' as const] : [])];
  const methodLabel = (method: ComputedFieldMethod) => method === 'whole' ? t('mapping.recipe.methods.whole') : t(`mapping.computed.methods.${method}`);
  const methodHelp = rule.method === 'whole' ? t('mapping.recipe.help.whole') : t(`mapping.computed.help.${rule.method}`);
  const cutProblem = problem !== null && CUT_PROBLEMS.some((key) => problem === `mapping.computed.problem.${key}`);
  const found = preview.results?.filter((result) => result.value !== null).length ?? 0;
  const pickedText = sheet
    ? t('mapping.recipe.rowsPicked', { count: samples.length, total: available.length })
    : t(fromFile ? 'mapping.computed.filesPicked' : 'mapping.computed.valuesPicked', { count: samples.length, total: available.length });
  const previewSummary = preview.results && !problem ? t('mapping.computed.previewSummary', { found, count: preview.results.length }) : pickedText;
  const errorLine = preview.error ? <p role='alert' className='flex gap-1.5 text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{preview.error}</p> : null;
  const emptyText = sheet ? t('mapping.recipe.noRows') : t(fromFile ? 'mapping.computed.noFiles' : 'mapping.computed.noFieldValues');
  const toTryText = sheet ? t('mapping.recipe.rowsToTry') : t(fromFile ? 'mapping.computed.filesToTry' : 'mapping.computed.valuesToTry');

  return <div className='space-y-2 text-xs' aria-label={t('mapping.computed.editorFor', { field: fieldLabel })} role='group'>
    <div className='rounded-lg border'>
      <RuleSection {...section('input')} title={t('mapping.computed.input')} icon={<FileText className='h-3.5 w-3.5' />} summary={inputLabel}
        help={sheet ? t('mapping.recipe.inputHelp') : t('mapping.computed.inputHelp')} invalid={problem === 'mapping.computed.problem.input'}>
        <Select value={inputValue(rule.input)} onValueChange={(value) => update({ input: inputFromValue(value) })}>
          <SelectTrigger className={cn(INPUT_COMPACT, 'w-56')} aria-label={t('mapping.computed.input')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {inputOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {fromFile && <label className='flex items-center gap-2'>
          <input type='checkbox' checked={rule.stripExtension ?? true} onChange={(event) => update({ stripExtension: event.target.checked })} />{t('mapping.computed.stripExtension')}
        </label>}
      </RuleSection>

      <RuleSection {...section('cut')} title={t('mapping.computed.method')} icon={<Split className='h-3.5 w-3.5' />} summary={methodSummary}
        help={methodHelp} invalid={cutProblem}>
        <div role='tablist' className='flex flex-wrap items-center gap-1'>
          {methods.map((method) =>
            <button key={method} type='button' role='tab' aria-selected={rule.method === method} onClick={() => setMethod(method)}
              className={cn('h-6 rounded-full border px-2.5 text-[11px]', rule.method === method ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'bg-background hover:bg-muted')}>{methodLabel(method)}</button>)}
          <button type='button' className='ml-auto text-[11px] text-muted-foreground underline' onClick={() => { if (advanced && rule.method === 'regex') setMethod(sheet ? 'whole' : 'split'); setAdvanced(!advanced); }}>
            {advanced ? t('mapping.computed.hideAdvanced') : t('mapping.computed.showAdvanced')}
          </button>
        </div>
        {rule.method === 'split' && <div className='flex flex-wrap items-end gap-3'>
          <FormField label={t('mapping.computed.delimiter')} htmlFor={`${id}-delimiter`}>
            <Input id={`${id}-delimiter`} className={cn(INPUT_COMPACT, 'w-24')} maxLength={10} value={rule.delimiter ?? ''} onChange={(event) => update({ delimiter: event.target.value })} aria-label={t('mapping.computed.delimiter')} /></FormField>
          <FormField label={t('mapping.computed.position')} htmlFor={`${id}-position`}>
            <Input id={`${id}-position`} className={cn(INPUT_COMPACT, 'w-20')} type='number' min={1} max={20} value={position} aria-label={t('mapping.computed.position')}
              onChange={(event) => { const value = Number.parseInt(event.target.value, 10) || 0; update({ part: fromEnd ? -value : value }); }} /></FormField>
          <label className='flex h-8 items-center gap-2'>
            <input type='checkbox' checked={fromEnd} onChange={(event) => update({ part: event.target.checked ? -position : position })} />{t('mapping.computed.fromEnd')}
          </label>
        </div>}
        {rule.method === 'between' && <div className='flex flex-wrap gap-3'>
          <FormField label={t('mapping.computed.after')} htmlFor={`${id}-after`}>
            <Input id={`${id}-after`} className={cn(INPUT_COMPACT, 'w-36')} maxLength={50} value={rule.after ?? ''} onChange={(event) => update({ after: event.target.value })} aria-label={t('mapping.computed.after')} /></FormField>
          <FormField label={t('mapping.computed.before')} htmlFor={`${id}-before`}>
            <Input id={`${id}-before`} className={cn(INPUT_COMPACT, 'w-36')} maxLength={50} value={rule.before ?? ''} onChange={(event) => update({ before: event.target.value })} aria-label={t('mapping.computed.before')} /></FormField>
        </div>}
        {rule.method === 'regex' && <div className='space-y-3'>
          <FormField label={t('mapping.computed.pattern')} htmlFor={`${id}-pattern`}>
            <Input id={`${id}-pattern`} className={cn(INPUT_COMPACT, 'font-mono')} maxLength={200} value={rule.pattern ?? ''} onChange={(event) => update({ pattern: event.target.value })} aria-label={t('mapping.computed.pattern')} /></FormField>
          <FormField label={t('mapping.computed.template')} htmlFor={`${id}-template`}>
            <Input id={`${id}-template`} className={cn(INPUT_COMPACT, 'font-mono')} maxLength={100} value={rule.template ?? ''} onChange={(event) => update({ template: event.target.value })} placeholder='{1}' aria-label={t('mapping.computed.template')} /></FormField>
        </div>}
      </RuleSection>

      <KeepSection section={section('keep')} fieldLabel={fieldLabel} take={rule.take} onTake={(take) => update({ take })} />
      <ValuePatternSection section={section('pattern')} fieldLabel={fieldLabel} pattern={rule.valuePattern} onPattern={(valuePattern) => update({ valuePattern })} />
      <CleanupSection section={section('transform')} fieldLabel={fieldLabel} value={rule.transform ?? 'none'} options={COMPUTED_TRANSFORMS}
        onChange={(transform) => update({ transform })} />

      <RuleSection {...section('preview')} title={sheet ? t('mapping.recipe.previewRows') : t('mapping.computed.preview')}
        icon={preview.loading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Play className='h-3.5 w-3.5' />}
        summary={available.length ? previewSummary : undefined}
        help={sheet ? t('mapping.recipe.rowsHelp', { max: MAX_SAMPLES }) : t('mapping.computed.filesHelp', { max: MAX_SAMPLES })}>
        {!available.length && <p className='text-muted-foreground'>{emptyText}</p>}
        {available.length > 0 && <div className='space-y-1'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-muted-foreground'>{toTryText}</span>
            <span className='text-[11px] tabular-nums text-muted-foreground'>{pickedText}</span>
          </div>
          {available.length > FILTER_FROM && <Input className='h-7 text-xs' value={filter} onChange={(event) => setFilter(event.target.value)}
            placeholder={sheet ? t('mapping.recipe.rowsFilter') : t('mapping.computed.filesFilter')} aria-label={sheet ? t('mapping.recipe.rowsFilter') : t('mapping.computed.filesFilter')} />}
          <ul className={cn(ROW_LIST, 'max-h-36 overflow-y-auto')}>
            {listed.map((item) => {
              const checked = chosenKeys.includes(item.key);
              return <li key={item.key}><label className='flex items-center gap-2 px-2 py-1 hover:bg-muted/40' title={item.input || item.label}>
                <input type='checkbox' checked={checked} disabled={!checked && chosenKeys.length >= MAX_SAMPLES}
                  aria-label={sheet ? t('mapping.recipe.rowFor', { row: item.label }) : t('mapping.computed.fileFor', { name: item.label })}
                  onChange={() => togglePicked(item.key)} />
                {sheet
                  ? <><span className='shrink-0 tabular-nums text-muted-foreground'>{item.label}</span><span className='min-w-0 truncate'>{item.input || '—'}</span></>
                  : <span className='min-w-0 truncate'>{item.label}</span>}
              </label></li>;
            })}
            {!listed.length && <li className='px-2 py-1 text-muted-foreground'>{sheet ? t('mapping.recipe.rowsNoMatch') : t('mapping.computed.filesNoMatch')}</li>}
          </ul>
          {!samples.length && <p className='text-muted-foreground'>{sheet ? t('mapping.recipe.rowsNone') : t('mapping.computed.filesNone')}</p>}
        </div>}
        {errorLine}
        {!problem && samples.length > 0 && preview.results?.map((result, index) => {
          const item = chosen[index];
          // The value after each step, when more than the last one ran.
          const steps = (result.steps ?? []).length > 1 || (result.steps?.length === 1 && result.value === null) ? result.steps! : [];
          return <div key={`${item?.key ?? result.input}-${index}`} className='space-y-0.5'>
            <div className='flex flex-wrap items-center gap-1.5'>
              {sheet && item && <span className='shrink-0 tabular-nums text-muted-foreground'>{item.label}</span>}
              <span className='max-w-full truncate text-muted-foreground'>{(result.input ?? samples[index]) || '—'}</span><ArrowRight className='h-3 w-3 shrink-0' />
              {result.value === null
                ? <span className='text-amber-700 dark:text-amber-400'>{t(`mapping.reading.reason.${result.reason}`, { values: '', detail: '' })}</span>
                : <span className='font-medium'>{result.value}</span>}
            </div>
            {steps.length > 0 && <p className='truncate pl-3 text-[11px] text-muted-foreground' aria-label={t('mapping.recipe.stepsFor', { value: result.input ?? '' })}>
              {steps.map((step) => `${t(`mapping.recipe.step.${step.step}`)}: ${step.value ?? t('mapping.recipe.stepNone')}`).join(' → ')}
            </p>}
          </div>;
        })}
      </RuleSection>
    </div>

    {problem && <p role='alert' className='flex gap-1.5 text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{t(problem as never)}</p>}
    {!problem && !sections.isOpen('preview') && errorLine}
  </div>;
}
