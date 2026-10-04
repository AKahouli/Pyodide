import type { ReactNode } from 'react';
import { Columns } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ComputedFieldRule, SourceExtractionStrategy, SourceFieldMapping } from '../../types';
import { INPUT_COMPACT, ROW_LIST } from '../form/FormParts';
import { AiFieldSettings, withoutAiSettings } from './AiFieldSettings';
import { FieldRulesEditor, STRATEGIES, usesRules, type FieldLiveReading, type LabelSuggestions } from './DocumentFieldRules';
import { FieldRecipeEditor, newColumnRecipe, newComputedRule, recipeReadsField, recipeStepCount, type RecipeSource } from './FieldRecipeEditor';
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

const MODES: Record<MappingSourceKind, SourceFieldMapping['mode'][]> = {
  document: ['extract', 'metadata', 'constant', 'computed', 'ignore'],
  sheet: ['direct', 'extract', 'computed', 'constant', 'ignore'],
  record: ['direct', 'extract', 'computed', 'constant', 'ignore'],
};
const NO_COLUMN = '__none';

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
export function withMode(mapping: SourceFieldMapping, mode: SourceFieldMapping['mode'], kind: MappingSourceKind, fallbackColumn?: string): SourceFieldMapping {
  if (kind === 'document') {
    const next: SourceFieldMapping = {
      ...mapping,
      mode,
      sourceField: mode === 'metadata' ? 'document_name' : null,
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

/** The other fields a field may be taken from: read from the source (or, on a sheet, taken from columns without reading another field). */
export function recipeInputs(mappings: SourceFieldMapping[], self: string, kind: MappingSourceKind): string[] {
  return mappings.filter((mapping) => mapping.targetAttribute !== self && mapping.mode !== 'ignore'
    && (mapping.mode !== 'computed' || (kind !== 'document' && !recipeReadsField(mapping.computed))))
    .map((mapping) => mapping.targetAttribute);
}

/** What a sheet field's recipe would save: nothing when it only reads its column as it is. */
export function recipeChangesValue(mapping: SourceFieldMapping) {
  return Boolean(mapping.computed && recipeStepCount(mapping.computed, mapping.sourceField) > 0);
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

export function FieldMappingList({ kind, modelId, attributes, mappings, onChange, onIgnore, addedFields = [], columns = [], columnLabels, columnSamples, extras, recipeSource, conceptId }: Readonly<{
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
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const attributeLabel = (key: string) => attributes.find((attribute) => attribute.key === key)?.label ?? key;
  const update = (index: number, next: SourceFieldMapping) => onChange(mappings.map((mapping, itemIndex) => itemIndex === index ? next : mapping));
  const setMode = (index: number, mode: SourceFieldMapping['mode']) => {
    const mapping = mappings[index];
    if (mode === 'ignore') onIgnore?.(mapping.targetAttribute);
    const attribute = attributes.find((item) => item.key === mapping.targetAttribute);
    update(index, withMode(mapping, mode, kind, attribute ? sameNamedColumn(attribute, columns) : undefined));
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
      const sample = readsColumn && mapping.sourceField ? columnSamples?.[mapping.sourceField] : undefined;
      return <div key={mapping.targetAttribute} className='space-y-2 px-3 py-2.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='flex min-w-[8rem] flex-1 items-center gap-1.5 text-xs font-medium'>
            <span className='truncate'>{fieldLabel}</span>
            {addedFields.includes(mapping.targetAttribute) && <span className='shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:text-sky-300'>{t('mapping.newField')}</span>}
          </span>
          {readsColumn && <Select value={mapping.sourceField ?? NO_COLUMN} onValueChange={(value) => update(index, { ...mapping, sourceField: value === NO_COLUMN ? null : value })}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'w-36 text-xs', !mapping.sourceField && 'border-amber-500/60')}
              aria-label={record ? t('derived.sourceFieldFor', { field: fieldLabel }) : t('mapping.cell.columnFor', { field: fieldLabel })}>
              <Columns className='mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground' /><SelectValue placeholder={record ? t('derived.chooseSourceField') : t('mapping.cell.chooseColumn')} />
            </SelectTrigger>
            <SelectContent>
              {!mapping.sourceField && <SelectItem value={NO_COLUMN}>{record ? t('derived.chooseSourceField') : t('mapping.cell.chooseColumn')}</SelectItem>}
              {columnChoices.map((column) => <SelectItem key={column} value={column}>{columnName(column)}</SelectItem>)}
            </SelectContent>
          </Select>}
          <Select value={mapping.mode} onValueChange={(value: SourceFieldMapping['mode']) => setMode(index, value)}>
            <SelectTrigger className={cn(INPUT_COMPACT, 'w-40 text-xs')} aria-label={t('mapping.methodFor', { field: mapping.targetAttribute })}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES[kind].map((mode) => <SelectItem key={mode} value={mode}>{modeLabel(mode)}</SelectItem>)}
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
