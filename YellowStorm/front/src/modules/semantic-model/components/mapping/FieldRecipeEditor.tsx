import { useEffect, useId, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, FileText, Loader2, Play, Plus, Split, Type, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { ComputedFieldInput, ComputedFieldMethod, ComputedFieldRule, ComputedFieldTransform, ComputedInputRef, ComputedJoinInput, ComputedJoinPart, ComputedPreviewResult } from '../../types';
import { FormField, INPUT_COMPACT, ROW_LIST } from '../form/FormParts';
import { useReadingText } from './readingText';
import { HelpTip, RuleSection, useOpenSections } from './RuleControls';
import { CleanupSection, KeepSection, patternProblem, takeProblem, ValuePatternSection } from './ValueShapeSections';

/**
 * One field's recipe, whatever the source: Take it from → How to cut it → Keep → What the value looks
 * like → Clean-up → Result. A document field is taken from its file name or another field; a sheet
 * field from a column or another field of the same row. Every step runs in the runtime with the same
 * functions for both (app/population/computed_fields.py).
 *
 * The "Take it from" choices are a list per source (`inputOptions`): a later input kind (e.g. an AI
 * reading of a column) adds an option there and, if it needs settings, its own pane after this one.
 * "Join several" takes several of these inputs and fixed texts, in order, joined into one text that the
 * next steps then shape (`{ kind: 'join', parts, separator, skipEmpty }`).
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
// Problems shown on the “Take it from” step.
const INPUT_PROBLEMS = ['input', 'joinParts', 'joinText', 'joinSeparator'];
/** A joined input: its parts, the fixed text a part may be, and its separator. */
export const MAX_JOIN_PARTS = 10;
const MAX_JOIN_TEXT = 100;
const MAX_SEPARATOR = 10;

/** What a recipe reads: its input, or each part of a join that is not a fixed text. */
export function recipeRefs(input: ComputedFieldInput | undefined): ComputedInputRef[] {
  if (!input) return [];
  return input.kind === 'join' ? input.parts.filter((part): part is ComputedInputRef => part.kind !== 'text') : [input];
}

/** Whether a recipe reads another field (alone or joined): no other recipe may then read it (no chains). */
export const recipeReadsField = (rule?: ComputedFieldRule) => recipeRefs(rule?.input).some((ref) => ref.kind === 'field');

/** The columns a recipe reads (a joined input's too). */
export const recipeColumns = (rule?: ComputedFieldRule) => recipeRefs(rule?.input).filter((ref) => ref.kind === 'column').map((ref) => ref.name);

/** How a part's value is named in a joined preview sample. */
const partKey = (ref: ComputedInputRef) => `${ref.kind}:${ref.name}`;

/** Where a field's recipe takes its value from, and what it can be tried on. */
export type RecipeSource =
  | {
    kind: 'document';
    /** The source's own files (a workspace's, subfolders included), offered to try the rule on. */
    fileSamples: string[];
    /** Values read for each field in the last document preview, when there is one. */
    fieldSamples?: Record<string, string[]>;
    /** The documents read by the last previews, each with its file name and the value of each field: a joined input is tried on these. */
    documentRows?: Array<{ key: string; label: string; fileName: string; values: Record<string, string> }>;
    /** Reads a few of the source's documents (as Preview data does), so a field's values can be tried on. */
    readDocuments?: { run: () => void; busy: boolean; disabled?: boolean; count: number };
  }
  | {
    kind: 'sheet';
    /** Every column of the sheet. */
    columns: string[];
    /** A bounded sample of the sheet's rows (the source analysis), to try the recipe on. */
    rows: Array<Record<string, unknown>>;
    /** The other mapped fields of the row read from a column as it is: the column, and its own recipe if any. */
    fieldInputs: Record<string, { column: string; recipe?: ComputedFieldRule }>;
    /** Fields read out of a cell (rules, AI) or taken from other fields: their values on the rows of the last row preview. */
    fieldValues?: Record<string, Array<{ row: number; value: string }>>;
    /** Fixed fields of the row, and their value. */
    fieldConstants?: Record<string, string>;
  }
  | {
    /**
     * Another concept's records (a derived source): a recipe takes a field of the source record (stored as a
     * `column` input, the record's fields being its columns) or another field of the derived record.
     */
    kind: 'record';
    /** The source concept's name. */
    sourceLabel: string;
    /** The source concept's fields, and their names. */
    columns: string[];
    columnLabels: Record<string, string>;
    /** Sample records, as their values by field, each named by `__recordLabel`. */
    rows: Array<Record<string, unknown>>;
    fieldInputs: Record<string, { column: string; recipe?: ComputedFieldRule }>;
    /** Fields read out of a source field (rules, AI): their values on the records of the last preview. */
    fieldValues?: Record<string, Array<{ row: number; value: string; label?: string }>>;
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
  const input: ComputedFieldInput = rule.input.kind === 'join'
    ? { kind: 'join', parts: rule.input.parts, separator: rule.input.separator ?? ' ', skipEmpty: rule.input.skipEmpty ?? true }
    : rule.input;
  const base: ComputedFieldRule = { input, method: rule.method, transform: rule.transform ?? 'none' };
  if (rule.take) base.take = rule.take;
  if (rule.valuePattern?.trim()) base.valuePattern = rule.valuePattern;
  if (recipeRefs(rule.input).some((ref) => ref.kind === 'file')) base.stripExtension = rule.stripExtension ?? true;
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
  if (rule.input.kind === 'join') {
    const { parts } = rule.input;
    if (parts.length < 2 || parts.length > MAX_JOIN_PARTS || !recipeRefs(rule.input).length) return 'mapping.computed.problem.joinParts';
    if (parts.some((part) => part.kind === 'text' && (!part.value || part.value.length > MAX_JOIN_TEXT))) return 'mapping.computed.problem.joinText';
    if ((rule.input.separator?.length ?? 0) > MAX_SEPARATOR) return 'mapping.computed.problem.joinSeparator';
  }
  for (const ref of recipeRefs(rule.input)) {
    if (!ref.name) return 'mapping.computed.problem.input';
    if (ref.kind === 'field' && !otherFields.includes(ref.name)) return 'mapping.computed.problem.input';
    if (ref.kind === 'column' && columns && !columns.includes(ref.name)) return 'mapping.computed.problem.input';
  }
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
const JOIN_INPUT = '__join';
const inputValue = (input: ComputedFieldInput) => {
  if (input.kind === 'join') return JOIN_INPUT;
  return input.kind === 'file' ? FILE_INPUT : `${input.kind}:${input.name}`;
};
function inputFromValue(value: string): ComputedInputRef {
  if (value === FILE_INPUT) return { kind: 'file', name: 'document_name' };
  const at = value.indexOf(':');
  const kind = value.slice(0, at);
  return { kind: kind === 'column' ? 'column' : 'field', name: value.slice(at + 1) };
}

const cellText = (value: unknown) => value === null || value === undefined ? '' : String(value).slice(0, MAX_SAMPLE_CHARS);

/** Something the recipe can be tried on: a file name, a value read, or a row of the sheet; for a join, each part's value. */
interface PreviewItem { key: string; label: string; input: string; parts?: Record<string, string> }

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
  const readingText = useReadingText();
  const id = useId();
  // A sheet's rows and another concept's records are tried on alike; only their wording differs.
  const table = source.kind === 'document' ? null : source;
  const sheet = table !== null;
  const record = source.kind === 'record' ? source : null;
  const rowsText = (key: string, options?: Record<string, unknown>) => t((record ? `derived.recipe.${key}` : `mapping.recipe.${key}`) as never, options as never);
  const columnOption = (column: string) => record
    ? t('derived.recipe.sourceFieldOption', { field: record.columnLabels[column] ?? column, source: record.sourceLabel })
    : t('mapping.recipe.columnOption', { column });
  const fieldOption = (field: string) => record ? t('derived.recipe.fieldOption', { field }) : t('mapping.recipe.fieldOption', { field });
  const [advanced, setAdvanced] = useState(rule.method === 'regex');
  const [preview, setPreview] = useState<{ results?: ComputedPreviewResult[]; error?: string; loading?: boolean }>({});
  const [picked, setPicked] = useState<{ key: string; items: string[] }>({ key: '', items: [] });
  const [filter, setFilter] = useState('');
  const sections = useOpenSections([]);
  const section = (key: string) => ({ id: `${id}-${key}`, open: sections.isOpen(key), onToggle: () => sections.toggle(key) });
  const update = (patch: Partial<ComputedFieldRule>) => onChange({ ...rule, ...patch });
  const fromEnd = (rule.part ?? 1) < 0;
  const position = Math.abs(rule.part ?? 1) || 1;
  const join: ComputedJoinInput | null = rule.input.kind === 'join' ? rule.input : null;
  const single: ComputedInputRef | null = rule.input.kind === 'join' ? null : rule.input;
  const refs = recipeRefs(rule.input);
  const fromFile = single?.kind === 'file';
  const readsFile = refs.some((ref) => ref.kind === 'file');

  // The sheet's columns once it has been read; until then, the columns the recipe reads are still offered.
  const knownColumns = table && table.columns.length ? table.columns : undefined;
  const columnChoices = table ? [...new Set([...table.columns, ...refs.filter((ref) => ref.kind === 'column' && ref.name).map((ref) => ref.name)])] : [];
  // “Take it from”: per source; a later input kind (AI on a column) is one more option here.
  const inputOptions: Array<{ value: string; label: string }> = sheet
    ? [...columnChoices.map((column) => ({ value: `column:${column}`, label: columnOption(column) })),
      ...fields.map((field) => ({ value: `field:${field.key}`, label: fieldOption(field.label) }))]
    : [{ value: FILE_INPUT, label: t('mapping.computed.fileName') }, ...fields.map((field) => ({ value: `field:${field.key}`, label: field.label }))];
  const firstOption = inputOptions[0]?.value;
  // A recipe never starts with nothing to take its value from: the first input offered is picked.
  const noInput = single !== null && !single.name;
  useEffect(() => {
    if (noInput && firstOption) update({ input: inputFromValue(firstOption) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noInput, firstOption]);

  // A field of the row taken from a column (with its own recipe, applied first).
  const fieldColumnOf = (name: string) => table?.fieldInputs[name];
  const shapedBy = (name: string) => {
    const input = fieldColumnOf(name);
    return input?.recipe && recipeStepCount(input.recipe, input.column) > 0 && !computedProblem(input.recipe, [], knownColumns)
      ? computedPayload(input.recipe) : undefined;
  };
  // What it can be tried on.
  const fieldInput = table && single?.kind === 'field' ? table.fieldInputs[single.name] : undefined;
  const inputRecipe = single?.kind === 'field' ? shapedBy(single.name) : undefined;
  const partRecipes = join ? Object.fromEntries(refs.filter((ref) => ref.kind === 'field')
    .flatMap((ref) => { const recipe = shapedBy(ref.name); return recipe ? [[partKey(ref), recipe]] : []; })) : {};
  const available: PreviewItem[] = (() => {
    if (table && join) {
      // Each row (or record) gives every part its value: a column, a field taken from a column, or a field read out of a cell.
      return table.rows.map((row, index) => {
        const number = typeof row.__sheetRow === 'number' ? row.__sheetRow : index + 2;
        const label = record ? String(row.__recordLabel ?? index + 1) : t('mapping.recipe.rowLabel', { row: number });
        const valueOf = (ref: ComputedInputRef) => {
          if (ref.kind === 'column') return cellText(row[ref.name]);
          const column = fieldColumnOf(ref.name)?.column;
          if (column) return cellText(row[column]);
          const fixed = table.kind === 'sheet' ? table.fieldConstants?.[ref.name] : undefined;
          if (fixed !== undefined) return fixed;
          const read = (table.fieldValues?.[ref.name] ?? []) as Array<{ row: number; value: string; label?: string }>;
          return cellText(read.find((item) => record ? item.label === label : item.row === number)?.value);
        };
        const parts = Object.fromEntries(refs.map((ref) => [partKey(ref), valueOf(ref)]));
        return { key: `row-${index}`, label, input: Object.values(parts).filter(Boolean).join(' · '), parts };
      });
    }
    if (table) {
      const column = single?.kind === 'column' ? single.name : fieldInput?.column;
      // A field read out of a cell: the values the last row preview read for it.
      if (!column && single?.kind === 'field') {
        return (table.fieldValues?.[single.name] ?? []).map((item: { row: number; value: string; label?: string }) => ({
          key: `row-${item.row}`, label: item.label ?? t('mapping.recipe.rowLabel', { row: item.row }), input: cellText(item.value) }));
      }
      if (!column) return [];
      return table.rows.map((row, index) => {
        if (record) return { key: `row-${index}`, label: String(row.__recordLabel ?? index + 1), input: cellText(row[column]) };
        const number = typeof row.__sheetRow === 'number' ? row.__sheetRow : index + 2;
        return { key: `row-${index}`, label: t('mapping.recipe.rowLabel', { row: number }), input: cellText(row[column]) };
      });
    }
    if (source.kind !== 'document') return [];
    if (join) {
      // The documents read by the last previews; without one, file names alone when only the file name is joined.
      const rows = source.documentRows?.length ? source.documentRows
        : refs.every((ref) => ref.kind === 'file') ? source.fileSamples.map((name) => ({ key: name, label: name, fileName: name, values: {} as Record<string, string> })) : [];
      return rows.map((row) => {
        const parts = Object.fromEntries(refs.map((ref) => [partKey(ref), cellText(ref.kind === 'file' ? row.fileName : row.values[ref.name])]));
        return { key: row.key, label: row.label, input: Object.values(parts).filter(Boolean).join(' · '), parts };
      });
    }
    const values = fromFile ? source.fileSamples : source.fieldSamples?.[single?.name ?? ''] ?? [];
    return [...new Set(values.filter(Boolean))].map((value) => ({ key: value, label: value, input: value }));
  })();
  const availableKey = available.map((item) => `${item.key}\u0000${item.input}`).join('\n');
  const chosen = picked.key === availableKey
    ? available.filter((item) => picked.items.includes(item.key)).slice(0, MAX_SAMPLES)
    : available.slice(0, DEFAULT_PICKED);
  const chosenKeys = chosen.map((item) => item.key);
  const samples = chosen.map((item) => item.input);
  const partSamples = join ? chosen.map((item) => item.parts ?? {}) : [];
  const togglePicked = (key: string) => {
    let next = chosenKeys;
    if (chosenKeys.includes(key)) next = chosenKeys.filter((other) => other !== key);
    else if (chosenKeys.length < MAX_SAMPLES) next = [...chosenKeys, key];
    setPicked({ key: availableKey, items: next });
  };
  const query = filter.trim().toLocaleLowerCase();
  const listed = query ? available.filter((item) => `${item.label} ${item.input}`.toLocaleLowerCase().includes(query)) : available;
  const problem = computedProblem(rule, fields.map((field) => field.key), knownColumns);
  // A sheet field reads a column or a field of the row, not a document.
  const problemText = (key: string) => sheet && key === 'mapping.computed.problem.input' ? rowsText('problemInput') : t(key as never);
  const payload = JSON.stringify(computedPayload(rule));
  const inputRecipeKey = inputRecipe ? JSON.stringify(inputRecipe) : '';
  const partRecipesKey = Object.keys(partRecipes).length ? JSON.stringify(partRecipes) : '';
  const sampleKey = join ? JSON.stringify(partSamples) : samples.join('\n');

  useEffect(() => {
    if (problem || !samples.length) { setPreview({}); return; }
    let cancelled = false;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      semanticModelApi.previewComputedField(modelId, join
        ? { computed: JSON.parse(payload) as ComputedFieldRule, partSamples,
          ...(partRecipesKey ? { partRecipes: JSON.parse(partRecipesKey) as Record<string, ComputedFieldRule> } : {}) }
        : {
          computed: JSON.parse(payload) as ComputedFieldRule, samples,
          ...(inputRecipeKey ? { inputRecipe: JSON.parse(inputRecipeKey) as ComputedFieldRule } : {}),
        })
        .then((result) => { if (!cancelled) setPreview({ results: result.results }); })
        .catch((error) => { if (!cancelled) setPreview({ error: parseApiError(error).message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, payload, sampleKey, problem, inputRecipeKey, partRecipesKey]);

  const setMethod = (method: ComputedFieldMethod) => update(method === 'split' ? { method, delimiter: rule.delimiter ?? '_', part: rule.part ?? 1 } : { method });
  const refLabel = (ref: ComputedInputRef) => {
    if (ref.kind === 'file') return t('mapping.computed.fileName');
    if (ref.kind === 'column') return columnOption(ref.name);
    const label = fields.find((field) => field.key === ref.name)?.label ?? ref.name;
    return sheet ? fieldOption(label) : label;
  };
  // A join's summary names its parts briefly: “Join · First name + “ ” + Last name”.
  const shortLabel = (part: ComputedJoinPart) => {
    if (part.kind === 'text') return `“${part.value}”`;
    if (part.kind === 'file') return t('mapping.recipe.join.fileName');
    if (part.kind === 'column') return record?.columnLabels[part.name] ?? part.name;
    return fields.find((field) => field.key === part.name)?.label ?? part.name;
  };
  const inputLabel = join ? t('mapping.recipe.join.summary', { parts: join.parts.map(shortLabel).join(' + ') }) : refLabel(single!);

  // Join several: the current input and the next one offered start the list.
  const chooseInput = (value: string) => {
    if (value !== JOIN_INPUT) { update({ input: inputFromValue(value) }); return; }
    const first = single?.name ? single : inputFromValue(firstOption ?? FILE_INPUT);
    const at = inputOptions.findIndex((option) => option.value === inputValue(first));
    const nextValue = inputOptions.length > 1 ? inputOptions[(at + 1) % inputOptions.length].value : undefined;
    const second: ComputedJoinPart = nextValue ? inputFromValue(nextValue) : { kind: 'text', value: '-' };
    update({ input: { kind: 'join', parts: [first, second], separator: ' ', skipEmpty: true } });
  };
  const setParts = (parts: ComputedJoinPart[]) => { if (join) update({ input: { ...join, parts } }); };
  const movePart = (index: number, by: number) => {
    if (!join) return;
    const parts = [...join.parts];
    const [moved] = parts.splice(index, 1);
    parts.splice(index + by, 0, moved);
    setParts(parts);
  };
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
  const inputProblem = problem !== null && INPUT_PROBLEMS.some((key) => problem === `mapping.computed.problem.${key}`);
  const iconButton = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40';
  const found = preview.results?.filter((result) => result.value !== null).length ?? 0;
  // A document join is tried on whole documents, as a file name is.
  const byFile = fromFile || Boolean(join);
  const pickedText = sheet
    ? rowsText('rowsPicked', { count: samples.length, total: available.length })
    : t(byFile ? 'mapping.computed.filesPicked' : 'mapping.computed.valuesPicked', { count: samples.length, total: available.length });
  const previewSummary = preview.results && !problem ? t('mapping.computed.previewSummary', { found, count: preview.results.length }) : pickedText;
  const errorLine = preview.error ? <p role='alert' className='flex gap-1.5 text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{preview.error}</p> : null;
  const emptyText = sheet ? rowsText('noRows') : t(fromFile ? 'mapping.computed.noFiles' : 'mapping.computed.noFieldValues');
  const toTryText = sheet ? rowsText('rowsToTry') : t(byFile ? 'mapping.computed.filesToTry' : 'mapping.computed.valuesToTry');

  return <div className='space-y-2 text-xs' aria-label={t('mapping.computed.editorFor', { field: fieldLabel })} role='group'>
    <div className='rounded-lg border'>
      <RuleSection {...section('input')} title={t('mapping.computed.input')} icon={<FileText className='h-3.5 w-3.5' />} summary={inputLabel}
        help={join ? t('mapping.recipe.join.help') : sheet ? rowsText('inputHelp') : t('mapping.computed.inputHelp')} invalid={inputProblem}>
        <Select value={inputValue(rule.input)} onValueChange={chooseInput}>
          <SelectTrigger className={cn(INPUT_COMPACT, 'w-56')} aria-label={t('mapping.computed.input')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {inputOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            <SelectItem value={JOIN_INPUT}>{t('mapping.recipe.join.option')}</SelectItem>
          </SelectContent>
        </Select>
        {join && <div className='space-y-1.5' role='group' aria-label={t('mapping.recipe.join.title')}>
          <ol className='space-y-1'>
            {join.parts.map((part, index) => {
              const number = index + 1;
              return <li key={index} className='flex items-center gap-1'>
                <span className='w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground'>{number}</span>
                {part.kind === 'text'
                  ? <Input className={cn(INPUT_COMPACT, 'w-56 font-mono')} maxLength={MAX_JOIN_TEXT} value={part.value} placeholder={t('mapping.recipe.join.textPlaceholder')}
                    aria-label={t('mapping.recipe.join.textFor', { index: number })}
                    onChange={(event) => setParts(join.parts.map((other, at) => at === index ? { kind: 'text', value: event.target.value } : other))} />
                  : <Select value={inputValue(part)} onValueChange={(value) => setParts(join.parts.map((other, at) => at === index ? inputFromValue(value) : other))}>
                    <SelectTrigger className={cn(INPUT_COMPACT, 'w-56')} aria-label={t('mapping.recipe.join.partFor', { index: number })}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {inputOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>}
                <button type='button' className={iconButton} disabled={index === 0} onClick={() => movePart(index, -1)}
                  aria-label={t('mapping.recipe.join.moveUp', { index: number })} title={t('mapping.recipe.join.moveUp', { index: number })}><ArrowUp className='h-3.5 w-3.5' /></button>
                <button type='button' className={iconButton} disabled={index === join.parts.length - 1} onClick={() => movePart(index, 1)}
                  aria-label={t('mapping.recipe.join.moveDown', { index: number })} title={t('mapping.recipe.join.moveDown', { index: number })}><ArrowDown className='h-3.5 w-3.5' /></button>
                <button type='button' className={iconButton} disabled={join.parts.length <= 2} onClick={() => setParts(join.parts.filter((_, at) => at !== index))}
                  aria-label={t('mapping.recipe.join.remove', { index: number })} title={t('mapping.recipe.join.remove', { index: number })}><X className='h-3.5 w-3.5' /></button>
              </li>;
            })}
          </ol>
          <div className='flex flex-wrap items-center gap-1.5 pl-5'>
            <button type='button' className='inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] hover:bg-muted disabled:opacity-40' disabled={join.parts.length >= MAX_JOIN_PARTS}
              onClick={() => setParts([...join.parts, inputFromValue(firstOption ?? FILE_INPUT)])}><Plus className='h-3 w-3' />{t('mapping.recipe.join.addPart')}</button>
            <button type='button' className='inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] hover:bg-muted disabled:opacity-40' disabled={join.parts.length >= MAX_JOIN_PARTS}
              onClick={() => setParts([...join.parts, { kind: 'text', value: '' }])}><Type className='h-3 w-3' />{t('mapping.recipe.join.addText')}</button>
          </div>
          <div className='flex flex-wrap items-center gap-3 pl-5'>
            <label className='flex items-center gap-1.5'>
              <span className='text-muted-foreground'>{t('mapping.recipe.join.separator')}</span>
              <Input className={cn(INPUT_COMPACT, 'w-16 font-mono')} maxLength={MAX_SEPARATOR} value={join.separator ?? ' '} placeholder={t('mapping.recipe.join.separatorNone')}
                aria-label={t('mapping.recipe.join.separator')} onChange={(event) => update({ input: { ...join, separator: event.target.value } })} />
              <HelpTip text={t('mapping.recipe.join.separatorHelp')} />
            </label>
            <label className='flex items-center gap-1.5'>
              <input type='checkbox' checked={join.skipEmpty ?? true} onChange={(event) => update({ input: { ...join, skipEmpty: event.target.checked } })} />{t('mapping.recipe.join.skipEmpty')}
              <HelpTip text={t('mapping.recipe.join.skipEmptyHelp')} />
            </label>
          </div>
        </div>}
        {readsFile && <label className='flex items-center gap-2'>
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

      <RuleSection {...section('preview')} title={sheet ? rowsText('previewRows') : t('mapping.computed.preview')}
        icon={preview.loading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Play className='h-3.5 w-3.5' />}
        summary={available.length ? previewSummary : undefined}
        help={sheet ? rowsText('rowsHelp', { max: MAX_SAMPLES }) : t('mapping.computed.filesHelp', { max: MAX_SAMPLES })}>
        {!available.length && <p className='text-muted-foreground'>{emptyText}</p>}
        {!available.length && source.kind === 'document' && !fromFile && source.readDocuments && <Button type='button' size='sm' variant='outline' className='h-7 text-xs'
          disabled={source.readDocuments.busy || source.readDocuments.disabled} onClick={source.readDocuments.run}>
          {source.readDocuments.busy ? <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <Play className='mr-1.5 h-3.5 w-3.5' />}
          {t('mapping.computed.readDocuments', { count: source.readDocuments.count })}
        </Button>}
        {available.length > 0 && <div className='space-y-1'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-muted-foreground'>{toTryText}</span>
            <span className='text-[11px] tabular-nums text-muted-foreground'>{pickedText}</span>
          </div>
          {available.length > FILTER_FROM && <Input className='h-7 text-xs' value={filter} onChange={(event) => setFilter(event.target.value)}
            placeholder={sheet ? rowsText('rowsFilter') : t('mapping.computed.filesFilter')} aria-label={sheet ? rowsText('rowsFilter') : t('mapping.computed.filesFilter')} />}
          <ul className={cn(ROW_LIST, 'max-h-36 overflow-y-auto')}>
            {listed.map((item) => {
              const checked = chosenKeys.includes(item.key);
              return <li key={item.key}><label className='flex items-center gap-2 px-2 py-1 hover:bg-muted/40' title={item.input || item.label}>
                <input type='checkbox' checked={checked} disabled={!checked && chosenKeys.length >= MAX_SAMPLES}
                  aria-label={sheet ? rowsText('rowFor', { row: item.label }) : t('mapping.computed.fileFor', { name: item.label })}
                  onChange={() => togglePicked(item.key)} />
                {sheet || (join && item.input !== item.label)
                  ? <><span className={cn('shrink-0 text-muted-foreground', sheet ? 'tabular-nums' : 'max-w-[40%] truncate')}>{item.label}</span><span className='min-w-0 truncate'>{item.input || '—'}</span></>
                  : <span className='min-w-0 truncate'>{item.label}</span>}
              </label></li>;
            })}
            {!listed.length && <li className='px-2 py-1 text-muted-foreground'>{sheet ? rowsText('rowsNoMatch') : t('mapping.computed.filesNoMatch')}</li>}
          </ul>
          {!samples.length && <p className='text-muted-foreground'>{sheet ? rowsText('rowsNone') : t('mapping.computed.filesNone')}</p>}
        </div>}
        {errorLine}
        {!problem && samples.length > 0 && preview.results?.map((result, index) => {
          const item = chosen[index];
          // The value after each step, when more than the last one ran.
          const steps = (result.steps ?? []).length > 1 || (result.steps?.length === 1 && result.value === null) ? result.steps! : [];
          return <div key={`${item?.key ?? result.input}-${index}`} className='space-y-0.5'>
            <div className='flex flex-wrap items-center gap-1.5'>
              {(sheet || join) && item && <span className={cn('shrink-0 text-muted-foreground', sheet ? 'tabular-nums' : 'max-w-[30%] truncate')}>{item.label}</span>}
              <span className='max-w-full truncate text-muted-foreground'>{(result.input ?? samples[index]) || '—'}</span><ArrowRight className='h-3 w-3 shrink-0' />
              {result.value === null
                ? <span className='text-amber-700 dark:text-amber-400'>{readingText.reason({ reason: result.reason })}</span>
                : <span className='font-medium'>{result.value}</span>}
            </div>
            {steps.length > 0 && <p className='truncate pl-3 text-[11px] text-muted-foreground' aria-label={t('mapping.recipe.stepsFor', { value: result.input ?? '' })}>
              {steps.map((step) => `${t(`mapping.recipe.step.${step.step}`)}: ${step.value ?? t('mapping.recipe.stepNone')}`).join(' → ')}
            </p>}
          </div>;
        })}
      </RuleSection>
    </div>

    {problem && <p role='alert' className='flex gap-1.5 text-amber-700 dark:text-amber-400'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{problemText(problem)}</p>}
    {!problem && !sections.isOpen('preview') && errorLine}
  </div>;
}
