import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Columns, KeyRound, Loader2, Play, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ComputedFieldRule, SourceExtractionStrategy, SourceFieldMapping } from '../../types';
import { INPUT_COMPACT, ROW_LIST } from '../form/FormParts';
import { AiFieldSettings, withoutAiSettings } from './AiFieldSettings';
import { FieldRulesEditor, STRATEGIES, usesRules, type FieldLiveReading, type LabelSuggestions } from './DocumentFieldRules';
import { FieldRecipeEditor, newColumnRecipe, newComputedRule, recipeRefs, recipeStepCount, type RecipeSource } from './FieldRecipeEditor';
import { ReadingTextContext, type ReadingTextKind } from './readingText';

/**
 * The fields of one mapping, one row each, whatever the source: how the field is read (its mode), and for a
 * field read out of a text, its rules (labels, where, keep, shape, clean-up) and its AI reading. A document
 * field reads the document's text; a sheet field reads the text of one column's cell, row by row, with the
 * same rules and the same AI (the runtime runs the same functions on both). A field can also be taken from
 * another field (a recipe), be fixed, or be left out; a sheet field can also be read from its column as is.
 * A field of a concept filled from another concept's records (`record`) reads a field of the source record
 * as a sheet field reads a column: as it is, out of its text, by a recipe; the record's fields are its columns.
 */

export type MappingSourceKind = 'document' | 'sheet' | 'record';

const TEXT_KIND: Record<MappingSourceKind, ReadingTextKind> = { document: 'document', sheet: 'cell', record: 'record' };

/** "Read all fields with": a strategy, or (sheets) reading each column as it is. */
export type ReadAllChoice = SourceExtractionStrategy | 'direct';

// A document's metadata modes are listed apart (see DOCUMENT_METADATA_FIELDS), below the others.
const MODES: Record<MappingSourceKind, SourceFieldMapping['mode'][]> = {
  document: ['extract', 'constant', 'computed', 'ignore'],
  sheet: ['direct', 'extract', 'computed', 'constant', 'ignore'],
  record: ['direct', 'extract', 'computed', 'constant', 'ignore'],
};
const NO_COLUMN = '__none';

/** What a document mapping can fill a field with from the document itself: mode 'metadata', one per source field. */
export const DOCUMENT_METADATA_FIELDS = ['document_name', 'workspace_id', 'document_id'] as const;
export type DocumentMetadataField = typeof DOCUMENT_METADATA_FIELDS[number];
const METADATA_LABEL = { document_name: 'metadata', workspace_id: 'workspaceId', document_id: 'documentId' } as const satisfies Record<DocumentMetadataField, string>;
const METADATA_PREFIX = 'metadata:';

/** The mode list entry a field shows: its mode, or for a document's metadata mode the property it reads. */
function modeChoice(mapping: SourceFieldMapping, kind: MappingSourceKind): string {
  if (kind !== 'document' || mapping.mode !== 'metadata') return mapping.mode;
  return `${METADATA_PREFIX}${DOCUMENT_METADATA_FIELDS.find((field) => field === mapping.sourceField) ?? 'document_name'}`;
}

/** A name compared without case, accents, spaces or punctuation: “Référence client” reads “referenceclient”. */
export function normalizeName(value: string) {
  return value.normalize('NFD').replaceAll(/[̀-ͯ]/g, '').toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/** The sheet column a concept field reads by default: the one named like its key or its label. */
export function sameNamedColumn(attribute: { key: string; label?: string }, columns: readonly string[]): string | undefined {
  const names = [attribute.key, attribute.label ?? ''].map(normalizeName).filter(Boolean);
  return columns.find((column) => names.includes(normalizeName(column)));
}

/** The column a sheet field reads: its own, or the one its recipe reads. */
export function fieldColumn(mapping: SourceFieldMapping): string | null {
  if (mapping.sourceField) return mapping.sourceField;
  return mapping.computed?.input.kind === 'column' ? mapping.computed.input.name : null;
}

/** A field read by rules alone keeps no AI settings. */
export function withStrategy(mapping: SourceFieldMapping, strategy: SourceExtractionStrategy): SourceFieldMapping {
  return strategy === 'deterministic' ? { ...withoutAiSettings(mapping), extractionStrategy: strategy } : { ...mapping, extractionStrategy: strategy };
}

/** The field with other rules; none means the plain default reading. */
export function withRules(mapping: SourceFieldMapping, rules: SourceFieldMapping['rules']): SourceFieldMapping {
  const { rules: _previous, ...rest } = mapping;
  return rules ? { ...rest, rules } : rest;
}

/** The field with another AI definition or agent; empty ones are not kept. */
export function withAiPatch(mapping: SourceFieldMapping, patch: Pick<SourceFieldMapping, 'semanticDefinition' | 'agentId'>): SourceFieldMapping {
  return {
    ...withoutAiSettings(mapping),
    ...(patch.semanticDefinition ? { semanticDefinition: patch.semanticDefinition } : {}),
    ...(patch.agentId ? { agentId: patch.agentId } : {}),
  };
}

/**
 * The field read another way. Only what that way uses is kept, so the payload matches what the runtime
 * expects; a sheet field keeps its column to go back to it.
 */
export function withMode(mapping: SourceFieldMapping, mode: SourceFieldMapping['mode'], kind: MappingSourceKind, fallbackColumn?: string, metadataField: DocumentMetadataField = 'document_name'): SourceFieldMapping {
  if (kind === 'document') {
    const next: SourceFieldMapping = {
      ...mapping,
      mode,
      sourceField: mode === 'metadata' ? metadataField : null,
      constantValue: mode === 'constant' ? mapping.constantValue ?? '' : undefined,
      computed: mode === 'computed' ? mapping.computed ?? newComputedRule() : undefined,
      // A strategy only applies to extracted fields.
      extractionStrategy: mode === 'extract' ? mapping.extractionStrategy ?? 'deterministic' : undefined,
      rules: mode === 'extract' ? mapping.rules : undefined,
    };
    return mode === 'extract' ? next : withoutAiSettings(next);
  }
  const column = fieldColumn(mapping) ?? fallbackColumn ?? null;
  const { targetAttribute } = mapping;
  if (mode === 'direct' || mode === 'ignore') return { sourceField: column, targetAttribute, mode };
  if (mode === 'constant') return { sourceField: null, targetAttribute, mode, constantValue: mapping.constantValue ?? '' };
  if (mode === 'computed') {
    const computed: ComputedFieldRule = mapping.computed ?? newColumnRecipe(column ?? '');
    return { sourceField: null, targetAttribute, mode, computed };
  }
  const kept = mapping.mode === 'extract' ? mapping : withoutAiSettings(mapping);
  return {
    sourceField: column, targetAttribute, mode,
    extractionStrategy: mapping.extractionStrategy ?? 'deterministic',
    ...(kept.rules ? { rules: kept.rules } : {}),
    ...(kept.semanticDefinition ? { semanticDefinition: kept.semanticDefinition } : {}),
    ...(kept.agentId ? { agentId: kept.agentId } : {}),
  };
}

/**
 * Every extracted field read the same way. On a sheet, a field read from its column as it is is read out of
 * it with the strategy, and “directly” reads every extracted field's column as it is again.
 */
export function readAllWith(mappings: SourceFieldMapping[], choice: ReadAllChoice, kind: MappingSourceKind): SourceFieldMapping[] {
  return mappings.map((mapping) => {
    if (kind !== 'document' && choice === 'direct') return mapping.mode === 'extract' ? withMode(mapping, 'direct', kind) : mapping;
    if (choice === 'direct') return mapping;
    if (mapping.mode === 'extract') return withStrategy(mapping, choice);
    if (kind !== 'document' && mapping.mode === 'direct' && mapping.sourceField) return withStrategy(withMode(mapping, 'extract', kind), choice);
    return mapping;
  });
}

/**
 * The other fields a field may be taken from. A document's: the fields read from it. A sheet row's or a
 * record's: every mapped field (on a sheet a fixed one too) but those that already read this one,
 * directly or through other fields, which would make a loop.
 */
export function recipeInputs(mappings: SourceFieldMapping[], self: string, kind: MappingSourceKind): string[] {
  if (kind === 'document') {
    return mappings.filter((mapping) => mapping.targetAttribute !== self && mapping.mode !== 'ignore' && mapping.mode !== 'computed')
      .map((mapping) => mapping.targetAttribute);
  }
  const recipes = new Map(mappings.filter((mapping) => mapping.computed && mapping.mode !== 'ignore')
    .map((mapping) => [mapping.targetAttribute, mapping.computed!]));
  // Whether `field` reads `self`, directly or through the fields its recipe reads.
  const readsSelf = (field: string, seen = new Set<string>()): boolean => {
    if (seen.has(field)) return false;
    seen.add(field);
    return recipeRefs(recipes.get(field)?.input).some((ref) => ref.kind === 'field' && (ref.name === self || readsSelf(ref.name, seen)));
  };
  return mappings.filter((mapping) => mapping.targetAttribute !== self && mapping.mode !== 'ignore'
    // A record's fixed values are set after its recipes run.
    && (kind === 'sheet' || mapping.mode !== 'constant')
    && !readsSelf(mapping.targetAttribute))
    .map((mapping) => mapping.targetAttribute);
}

/** What a sheet field's recipe would save: nothing when it only reads its column as it is. */
export function recipeChangesValue(mapping: SourceFieldMapping) {
  return Boolean(mapping.computed && recipeStepCount(mapping.computed, mapping.sourceField) > 0);
}

/** Fields folded to one line each, opened one by one; with their key toggle and what changed since saving. */
export interface FieldFolding {
  open: string[];
  onToggle: (field: string) => void;
  /** The line a folded field shows: where it reads, how, what it found. */
  summary: (mapping: SourceFieldMapping) => ReactNode;
  isKey?: (field: string) => boolean;
  onToggleKey?: (field: string) => void;
  changed?: (mapping: SourceFieldMapping) => boolean;
  onRevert?: (field: string) => void;
  /** Reads this one field on the sample records now; why it cannot, when it cannot. */
  onRead?: (field: string) => void;
  readBlocked?: string;
  readingField?: string | null;
}

/** What a field row shows beside its settings, given by the drawer that knows the source. */
export interface FieldRowExtras {
  /** The value read for the field on the shown document or row, and how to find it there. */
  live?: ReactNode;
  /** The labels found in the source's texts, offered as labels the value follows. */
  suggestions?: LabelSuggestions;
  /** The live reading the value is shaped on. */
  reading?: FieldLiveReading;
  /** Pages of the document shown, when known. */
  pageCount?: number;
}

// A column value short enough to show under a field that extracts from it.
const SHORT_SAMPLE = 120;

export function FieldMappingList({ kind, modelId, attributes, mappings, onChange, onIgnore, addedFields = [], columns = [], columnLabels, columnSamples, extras, recipeSource, conceptId, folding }: Readonly<{
  kind: MappingSourceKind;
  modelId: string;
  attributes: ReadonlyArray<{ key: string; label: string; description?: string }>;
  mappings: SourceFieldMapping[];
  onChange: (mappings: SourceFieldMapping[]) => void;
  /** A field left out: it can no longer be part of the identity. */
  onIgnore?: (field: string) => void;
  /** Fields added to the concept since the mapping was saved. */
  addedFields?: string[];
  /** Sheets: the columns a field can be read from, and a sample of each. */
  columns?: string[];
  /** Records: the names of the source concept's fields, shown instead of their keys. */
  columnLabels?: Record<string, string>;
  columnSamples?: Record<string, string>;
  extras?: (mapping: SourceFieldMapping, index: number) => FieldRowExtras;
  recipeSource: RecipeSource;
  /** Documents: the concept whose text fields can change their search index next to the AI pane. */
  conceptId?: string;
  folding?: FieldFolding;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const attributeLabel = (key: string) => attributes.find((attribute) => attribute.key === key)?.label ?? key;
  const update = (index: number, next: SourceFieldMapping) => onChange(mappings.map((mapping, itemIndex) => itemIndex === index ? next : mapping));
  const setMode = (index: number, choice: string) => {
    const mapping = mappings[index];
    const metadataField = choice.startsWith(METADATA_PREFIX) ? choice.slice(METADATA_PREFIX.length) as DocumentMetadataField : undefined;
    const mode = metadataField ? 'metadata' : choice as SourceFieldMapping['mode'];
    if (mode === 'ignore') onIgnore?.(mapping.targetAttribute);
    const attribute = attributes.find((item) => item.key === mapping.targetAttribute);
    update(index, withMode(mapping, mode, kind, attribute ? sameNamedColumn(attribute, columns) : undefined, metadataField));
  };
  const modeLabel = (mode: SourceFieldMapping['mode']) => t(`mapping.method.${mode}`);
  const record = kind === 'record';
  const columnName = (column: string) => columnLabels?.[column] ?? column;

  return <ReadingTextContext.Provider value={TEXT_KIND[kind]}><div className={ROW_LIST}>
    {mappings.map((mapping, index) => {
      const fieldLabel = attributeLabel(mapping.targetAttribute);
      const readsColumn = kind !== 'document' && (mapping.mode === 'direct' || mapping.mode === 'extract');
      const row = extras?.(mapping, index) ?? {};
      const columnChoices = [...new Set([...columns, ...(mapping.sourceField ? [mapping.sourceField] : [])])];
      // The value a column gives; a long text read out by rules or AI is not repeated under every field.
      const columnSample = readsColumn && mapping.sourceField ? columnSamples?.[mapping.sourceField] : undefined;
      const sample = columnSample && (mapping.mode === 'direct' || (columnSample.length <= SHORT_SAMPLE && !columnSample.includes('\n'))) ? columnSample : undefined;
      const open = !folding || folding.open.includes(mapping.targetAttribute);
      const isKey = folding?.isKey?.(mapping.targetAttribute) ?? false;
      const changed = folding?.changed?.(mapping) ?? false;
      const header = folding && <div className='flex items-center gap-1.5'>
        <button type='button' className='flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs' aria-expanded={open}
          aria-label={t('mapping.fold.toggle', { field: fieldLabel })} onClick={() => folding.onToggle(mapping.targetAttribute)}>
          {open ? <ChevronDown className='h-3.5 w-3.5 shrink-0 text-muted-foreground' /> : <ChevronRight className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />}
          <span className='shrink-0 truncate font-medium'>{fieldLabel}</span>
          {changed && <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500' title={t('mapping.fold.changed')} aria-label={t('mapping.fold.changed')} />}
          <span className={cn('min-w-0 flex-1 truncate', mapping.mode === 'ignore' ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{folding.summary(mapping)}</span>
        </button>
        {folding.onRead && mapping.mode !== 'ignore' && <button type='button' disabled={Boolean(folding.readBlocked) || Boolean(folding.readingField)}
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40'
          aria-label={t('mapping.fold.readFor', { field: fieldLabel })} title={folding.readBlocked ?? t('mapping.fold.readFor', { field: fieldLabel })}
          onClick={() => folding.onRead!(mapping.targetAttribute)}>
          {folding.readingField === mapping.targetAttribute ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Play className='h-3.5 w-3.5' />}</button>}
        {changed && folding.onRevert && <button type='button' className='flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label={t('mapping.fold.revertFor', { field: fieldLabel })} onClick={() => folding.onRevert!(mapping.targetAttribute)}>
          <Undo2 className='h-3 w-3' />{t('mapping.fold.revert')}</button>}
        {folding.onToggleKey && mapping.mode !== 'ignore' && <button type='button' aria-pressed={isKey} aria-label={t('derived.keyFor', { field: fieldLabel })}
          title={t('derived.keyFor', { field: fieldLabel })}
          className={cn('flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px]',
            isKey ? 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'border-transparent text-muted-foreground/60 hover:border-border hover:text-muted-foreground')}
          onClick={() => folding.onToggleKey!(mapping.targetAttribute)}>
          <KeyRound className='h-3 w-3' />{isKey && t('derived.key')}</button>}
      </div>;
      if (!open) return <div key={mapping.targetAttribute} className='px-3 py-2'>{header}</div>;
      return <div key={mapping.targetAttribute} className={cn('space-y-2 px-3 py-2.5', folding && 'bg-muted/20')}>
        {header}
        <div className='flex flex-wrap items-center gap-2'>
          {!folding ? <span className='flex min-w-[8rem] flex-1 items-center gap-1.5 text-xs font-medium'>
            <span className='truncate'>{fieldLabel}</span>
            {addedFields.includes(mapping.targetAttribute) && <span className='shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-300'>{t('mapping.newField')}</span>}
          </span> : <span className='flex-1' />}
          {readsColumn && <Select value={mapping.sourceField ?? NO_COLUMN} onValueChange={(value) => update(index, { ...mapping, sourceField: value === NO_COLUMN ? null : value })}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'w-36 text-xs', !mapping.sourceField && 'border-amber-500/60')}
              aria-label={record ? t('derived.sourceFieldFor', { field: fieldLabel }) : t('mapping.cell.columnFor', { field: fieldLabel })}>
              <Columns className='me-1 h-3.5 w-3.5 shrink-0 text-muted-foreground' /><SelectValue placeholder={record ? t('derived.chooseSourceField') : t('mapping.cell.chooseColumn')} />
            </SelectTrigger>
            <SelectContent>
              {!mapping.sourceField && <SelectItem value={NO_COLUMN}>{record ? t('derived.chooseSourceField') : t('mapping.cell.chooseColumn')}</SelectItem>}
              {columnChoices.map((column) => <SelectItem key={column} value={column}>{columnName(column)}</SelectItem>)}
            </SelectContent>
          </Select>}
          <Select value={modeChoice(mapping, kind)} onValueChange={(value) => setMode(index, value)}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'w-40 text-xs')} aria-label={t('mapping.methodFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES[kind].map((mode) => <SelectItem key={mode} value={mode}>{modeLabel(mode)}</SelectItem>)}
              {kind === 'document' && <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className='py-1 text-[11px] font-medium text-muted-foreground'>{t('mapping.methodGroupDocument')}</SelectLabel>
                  {DOCUMENT_METADATA_FIELDS.map((field) => <SelectItem key={field} value={`${METADATA_PREFIX}${field}`}>{t(`mapping.method.${METADATA_LABEL[field]}`)}</SelectItem>)}
                </SelectGroup>
              </>}
            </SelectContent>
          </Select>
          {mapping.mode === 'extract' && <Select value={mapping.extractionStrategy ?? 'deterministic'} onValueChange={(value: SourceExtractionStrategy) => update(index, withStrategy(mapping, value))}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'w-36 text-xs')} aria-label={t('mapping.strategyFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((strategy) => <SelectItem key={strategy} value={strategy}>{t(`mapping.strategy.${strategy}`)}</SelectItem>)}
            </SelectContent>
          </Select>}
        </div>
        {readsColumn && !mapping.sourceField && <p role='status' className='text-[11px] text-amber-700 dark:text-amber-400'>{record ? t('derived.noSourceField') : t('mapping.cell.noColumn')}</p>}
        {sample && <p className='truncate text-[11px] text-muted-foreground' title={sample}>{sample}</p>}
        {row.live}
        {mapping.mode === 'extract' && usesRules(mapping.extractionStrategy) && <FieldRulesEditor fieldLabel={fieldLabel} textKind={kind === 'document' ? 'document' : 'cell'}
          rules={mapping.rules} onChange={(rules) => update(index, withRules(mapping, rules))} suggestions={row.suggestions}
          pageCount={row.pageCount} live={row.reading} />}
        {mapping.mode === 'extract' && (mapping.extractionStrategy === 'ai' || mapping.extractionStrategy === 'rules_then_ai') && <AiFieldSettings
          fieldLabel={fieldLabel} mapping={mapping} conceptId={conceptId}
          attributeDescription={attributes.find((attribute) => attribute.key === mapping.targetAttribute)?.description}
          onChange={(patch) => update(index, withAiPatch(mapping, patch))} />}
        {mapping.mode === 'computed' && <FieldRecipeEditor modelId={modelId} fieldLabel={fieldLabel}
          rule={mapping.computed ?? (kind !== 'document' ? newColumnRecipe(columns[0] ?? '') : newComputedRule())}
          onChange={(computed) => update(index, { ...mapping, computed })}
          fields={recipeInputs(mappings, mapping.targetAttribute, kind).map((key) => ({ key, label: attributeLabel(key) }))}
          source={recipeSource} />}
        {mapping.mode === 'constant' && <Input className={INPUT_COMPACT} value={String(mapping.constantValue ?? '')} aria-label={t('mapping.constantPlaceholder')}
          onChange={(event) => update(index, { ...mapping, constantValue: event.target.value })} placeholder={t('mapping.constantPlaceholder')} />}
      </div>;
    })}
  </div></ReadingTextContext.Provider>;
}
