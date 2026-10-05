import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, GitMerge, KeyRound, Loader2, RefreshCw, Rows, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useDerivedSources, useIdentityRules } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSemanticModelEditorStore } from '../../store';
import type { AiExtractionSettings, AttributeDefinition, DerivedConflictRule, DerivedExpand, DerivedFieldPreviewResponse, DerivedSource, DocumentFieldReading, MappingSettings, SourceFieldMapping } from '../../types';
import { DELETE_BUTTON, FORM_SECTION, FormField, INPUT, ROW_LIST, SectionHeader } from '../form/FormParts';
import { AiLimitsEditor, FieldReadingResult, limitProblem, ReadAllFieldsBar, rulesProblem, usesAi as mappingsUseAi, usesRules, type LabelSuggestions } from './DocumentFieldRules';
import { MappingPresetBar } from './MappingPresetBar';
import { FieldLiveStatus } from './DocumentPreviewPane';
import { computedProblem, recipeColumns } from './FieldRecipeEditor';
import { FieldMappingList, readAllWith, recipeInputs } from './FieldMappingList';
import { derivedPayload, derivedRows, expandPayload, expandProblem, isItemField, ITEM_FIELD, itemColumns, newDerivedRows, recordValue, sentSourceFields } from './derivedMapping';
import { ExpandCard } from './ExpandCard';
import { ReadingTextContext } from './readingText';
import { adaptToSheet, cellLabelSuggestions, cellValue } from './sheetMapping';
import { foundSpans, markText, type Highlight } from './SheetSourceMappingDrawer';

export interface DerivedSourceTarget {
  conceptId: string;
  /** The derived source to change; none to add one. */
  derived?: DerivedSource;
}

export const CONFLICT_RULES: DerivedConflictRule[] = ['most_frequent', 'latest', 'longest', 'leave_empty'];
// Sample records read for the fields until the person picks others, at most, and from when the list gets a filter.
const DEFAULT_RECORDS = 5;
const MAX_RECORDS = 20;
const FILTER_FROM = 8;
// The runtime's default bound on records read with AI per derived source and run (SEMANTIC_MAX_AI_ROWS_PER_SOURCE).
const MAX_AI_RECORDS = 500;

/** Whether a field reads an item of the expanded field (itself, or by a recipe). */
const usesItem = (field: { sourceAttribute?: string; mode?: string; computed?: unknown }) =>
  isItemField(field.sourceAttribute) || recipeColumnsOf(field as never).some(isItemField);
const recipeColumnsOf = (field: { mode?: string; computed?: Parameters<typeof recipeColumns>[0] }) => field.mode === 'computed' ? recipeColumns(field.computed) : [];

const words = (text: string) => text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The source field most likely to fill a field: the same name, or a name that ends with it
 * ("customer_id" for "id", "customer name" for "name"). The shortest such name wins.
 */
export function suggestSourceField(field: Pick<AttributeDefinition, 'key' | 'label'>, sourceFields: Array<Pick<AttributeDefinition, 'key' | 'label'>>): string | undefined {
  const exact = sourceFields.find((candidate) => candidate.key === field.key);
  if (exact) return exact.key;
  const wanted = [words(field.key), words(field.label)].filter((list) => list.length);
  const matches = sourceFields.filter((candidate) => [words(candidate.key), words(candidate.label)].some((have) =>
    wanted.some((want) => want.length <= have.length && want.every((word, index) => have[have.length - want.length + index] === word))));
  return matches.sort((left, right) => left.key.length - right.key.length)[0]?.key;
}

/**
 * Fill a concept from another concept's records: one record per distinct key value they carry, e.g. the
 * organizations named by the customer id and name of every contract. What is its own here: the source
 * concept, the key fields records are matched on, and what to keep when records sharing a key disagree.
 * The fields are the shared field mapping (as for a document or a sheet): each one copied from a source
 * field, read out of its text with rules and/or AI, taken by a recipe, or fixed, tried on sample records.
 */
export function DerivedSourceDrawer({ modelId, target, onClose }: Readonly<{ modelId: string; target: DerivedSourceTarget | null; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const derivedSources = useDerivedSources(target ? modelId : undefined).data ?? [];
  const identityRules = useIdentityRules(target ? modelId : undefined).data ?? [];
  const concept = graph?.nodes.find((node) => node.id === target?.conceptId);
  const attributes = useMemo(() => concept?.attributes ?? [], [concept]);
  const [sourceConceptId, setSourceConceptId] = useState('');
  const [rows, setRows] = useState<SourceFieldMapping[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [rule, setRule] = useState<DerivedConflictRule>('most_frequent');
  const [orderBy, setOrderBy] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [recordFilter, setRecordFilter] = useState('');
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [aiSettings, setAiSettings] = useState<Partial<AiExtractionSettings>>({});
  // Several records per source record: one source field split into items, each read as a record.
  const [expand, setExpand] = useState<DerivedExpand | null>(null);

  // A concept filled from another one cannot fill a third, so derivations never chain.
  const others = derivedSources.filter((source) => source.id !== target?.derived?.id);
  const candidates = useMemo(() => (graph?.nodes ?? []).filter((node) => !node.systemKey && node.id !== target?.conceptId
    && node.attributes.length > 0 && !others.some((other) => other.conceptId === node.id)), [graph?.nodes, others, target?.conceptId]);
  const fillsAnother = others.some((other) => other.sourceConceptId === target?.conceptId);
  const source = graph?.nodes.find((node) => node.id === sourceConceptId);
  const sourceFields = useMemo(() => source?.attributes.map((field) => field.key) ?? [], [source]);
  const sourceLabels = useMemo(() => Object.fromEntries((source?.attributes ?? []).map((field) => [field.key, field.label])), [source]);
  const attributeLabel = (key: string) => attributes.find((attribute) => attribute.key === key)?.label ?? key;

  const suggestedRows = (sourceId: string) => {
    const from = graph?.nodes.find((node) => node.id === sourceId);
    return newDerivedRows(attributes, (field) => from ? suggestSourceField({ key: field.key, label: field.label ?? field.key }, from.attributes) : undefined);
  };

  useEffect(() => {
    if (!target || !concept) return;
    const derived = target.derived;
    // A concept already linked to this one is the likeliest source: contracts name their customer.
    const linked = graph?.relations.flatMap((relation) => relation.sourceNodeTypeId === concept.id ? [relation.targetNodeTypeId]
      : relation.targetNodeTypeId === concept.id ? [relation.sourceNodeTypeId] : []) ?? [];
    const start = derived?.sourceConceptId ?? candidates.find((node) => linked.includes(node.id))?.id ?? candidates[0]?.id ?? '';
    setSourceConceptId(start);
    // A field removed from the source concept since saving is no longer offered, so it is not kept.
    const fromFields = graph?.nodes.find((node) => node.id === start)?.attributes.map((field) => field.key) ?? [];
    // An expanding source's fields may read its items (`@item`, `@item.email`), which are not fields of the concept.
    const itemFields = derived?.expand ? derived.fieldMappings.map((field) => field.sourceAttribute ?? '').filter(isItemField) : [];
    const next = derived ? derivedRows(derived.fieldMappings, concept.attributes, [...fromFields, ...itemFields]) : suggestedRows(start);
    setRows(next);
    const identity = identityRules.find((item) => item.conceptId === concept.id)?.fields ?? [];
    setKeys(identity.length ? identity : next.filter((row) => row.mode !== 'ignore').slice(0, 1).map((row) => row.targetAttribute));
    setRule(derived?.conflictRule ?? 'most_frequent');
    setOrderBy(derived?.orderBy && fromFields.includes(derived.orderBy) ? derived.orderBy : '');
    setAiSettings({ ...(derived?.aiSettings ?? {}) });
    setExpand(derived?.expand ?? null);
    setPicked(null);
    setShownId(null);
    setHighlight(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.conceptId, target?.derived?.id, concept?.id, identityRules.length, candidates.length]);

  const savedOrder = useMemo(() => (target?.derived?.fieldMappings ?? []).map((field) => field.targetAttribute), [target?.derived]);
  const payload = useMemo(() => derivedPayload(rows, savedOrder), [rows, savedOrder]);
  const payloadRows = rows.filter((row) => row.mode !== 'ignore');
  const usesAi = mappingsUseAi(payloadRows);
  // What blocks saving, field by field: as on a sheet, a source field is a column.
  const fieldProblems = payloadRows.filter((row) => {
    if ((row.mode === 'direct' || row.mode === 'extract') && !row.sourceField) return true;
    if (row.mode === 'extract' && usesRules(row.extractionStrategy) && rulesProblem(row.rules)) return true;
    if (row.mode === 'computed') return Boolean(computedProblem(row.computed, recipeInputs(payloadRows, row.targetAttribute, 'record'), columns));
    return false;
  }).map((row) => row.targetAttribute);
  const unmappedKey = keys.find((key) => !payload.some((field) => field.targetAttribute === key));
  const problem = !source ? t('derived.problem.source')
    : fillsAnother ? t('derived.problem.fillsAnother', { concept: concept?.label ?? '' })
    : !payload.length ? t('derived.problem.noField')
    : fieldProblems.length ? t('mapping.cell.saveBlocked', { fields: fieldProblems.map(attributeLabel).join(', ') })
    : !keys.length ? t('derived.problem.noKey')
    : unmappedKey ? t('derived.problem.keyNotFilled', { field: attributeLabel(unmappedKey) })
    : rule === 'latest' && !orderBy ? t('derived.problem.orderBy')
    : usesAi && limitProblem(aiSettings) ? t('derived.problem.aiLimits')
    : expandProblem(expand) ? t(expandProblem(expand) as 'derived.expand.problem.field')
    : payload.some((field) => usesItem(field)) && !expand ? t('derived.expand.problem.itemWithoutExpand')
    : null;

  // Sample records: the source concept's records in the data in use.
  const samplesQuery = useQuery({
    queryKey: [...semanticModelQueryKeys.derivedSources(modelId), 'samples', sourceConceptId],
    queryFn: () => semanticModelApi.conceptRecords(modelId, sourceConceptId, { limit: MAX_RECORDS }),
    enabled: Boolean(target && sourceConceptId),
    staleTime: 30_000,
  });
  const samples = useMemo(() => samplesQuery.data?.records ?? [], [samplesQuery.data]);
  const pickedIds = (picked ?? samples.slice(0, DEFAULT_RECORDS).map((record) => record.id)).filter((id) => samples.some((record) => record.id === id));
  const shown = samples.find((record) => record.id === shownId && pickedIds.includes(record.id)) ?? samples.find((record) => record.id === pickedIds[0]);
  const togglePicked = (id: string) => setPicked(pickedIds.includes(id) ? pickedIds.filter((item) => item !== id)
    : pickedIds.length < MAX_RECORDS ? [...pickedIds, id] : pickedIds);
  const usedFields = sentSourceFields(payload, expand);
  // A field read out of an item shows the source field the items come from.
  const textFields = [...new Set(payload.filter((field) => field.mode === 'extract' && field.sourceAttribute)
    .map((field) => isItemField(field.sourceAttribute) ? expand?.field ?? '' : field.sourceAttribute!).filter(Boolean))];
  const listedSamples = recordFilter.trim()
    ? samples.filter((record) => `${record.label} ${usedFields.map((field) => String(recordValue(record, field) ?? '')).join(' ')}`
      .toLocaleLowerCase().includes(recordFilter.trim().toLocaleLowerCase()))
    : samples;

  // The picked records read with the fields as a run would; rules and copies as they change, AI on request.
  const canRead = !problem && pickedIds.length > 0;
  const draftKey = canRead ? JSON.stringify([payload, pickedIds, sourceConceptId, target?.conceptId, usesAi ? aiSettings : null, expandPayload(expand) ?? null]) : '';
  const requestRef = useRef<() => Parameters<typeof semanticModelApi.previewDerivedFields>[1]>();
  requestRef.current = () => ({
    conceptId: target!.conceptId, sourceConceptId, fieldMappings: payload,
    ...(usesAi && Object.keys(aiSettings).length ? { aiSettings } : {}),
    ...(expandPayload(expand) ? { expand: expandPayload(expand) } : {}),
    records: pickedIds.map((id) => {
      const record = samples.find((item) => item.id === id)!;
      return { entityId: id, values: Object.fromEntries(usedFields.map((field) => [field, cellValue(recordValue(record, field))])) };
    }),
  });
  const [live, setLive] = useState<{ key: string; result?: DerivedFieldPreviewResponse; error?: string; loading: boolean }>({ key: '', loading: false });
  const liveKey = useRef('');
  const readRecords = useCallback(async () => {
    const key = draftKey;
    if (!key || !requestRef.current) return;
    liveKey.current = key;
    setLive((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const result = await semanticModelApi.previewDerivedFields(modelId, requestRef.current());
      if (liveKey.current === key) setLive({ key, result, loading: false });
    } catch (error) {
      if (liveKey.current === key) setLive((current) => ({ ...current, key, error: parseApiError(error).message, loading: false }));
    }
  }, [draftKey, modelId]);
  useEffect(() => {
    if (!draftKey || usesAi) return;
    const timer = setTimeout(() => void readRecords(), 500);
    return () => clearTimeout(timer);
  }, [draftKey, usesAi, readRecords]);
  const stale = Boolean(live.result) && live.key !== draftKey;
  // The fields of the items, offered beside the source fields: the item, then the paths of object items.
  const itemFields = expand ? [...new Set([ITEM_FIELD, ...(live.result?.itemFields ?? []),
    ...payload.flatMap((field) => [field.sourceAttribute ?? '', ...(field.mode === 'computed' ? recipeColumnsOf(field) : [])]).filter(isItemField)])] : [];
  const columns = [...itemFields, ...sourceFields];
  const columnLabels = { ...sourceLabels, ...Object.fromEntries(itemFields.map((field) => [field, field === ITEM_FIELD
    ? t('derived.expand.item') : t('derived.expand.itemPath', { path: field.slice(ITEM_FIELD.length + 1) })])) };
  const readingsOf = (id?: string) => live.result?.records.find((record) => record.entityId === id)?.fields;
  const shownReadings = readingsOf(shown?.id);
  const recordLabel = (id: string) => samples.find((record) => record.id === id)?.label || id;
  // Each item read by the preview, as a row of values a recipe can be tried on.
  const itemRows = (live.result?.records ?? []).filter((record) => record.item !== undefined).map((record) => {
    const from = samples.find((item) => item.id === record.entityId);
    return {
      ...(from ? Object.fromEntries(sourceFields.map((field) => [field, recordValue(from, field)])) : {}),
      ...itemColumns(record.itemText ?? ''), __entityId: record.entityId,
      __recordLabel: `${recordLabel(record.entityId)} · ${record.item}`,
    } as Record<string, unknown> & { __entityId: string };
  });
  const fieldValues = useMemo(() => Object.fromEntries(attributes.map((attribute) => [attribute.key, (live.result?.records ?? []).flatMap((record, index) => {
    const reading = record.fields[attribute.key];
    return reading?.reason === 'found' && reading.value != null ? [{ row: index + 1, value: String(reading.value), label: recordLabel(record.entityId) }] : [];
  })])), [attributes, live.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels starting lines in each source field's texts, offered as labels a value follows.
  const labelsByField = useMemo(() => Object.fromEntries(textFields.map((field) => {
    const texts = samples.map((record) => String(recordValue(record, field) ?? '')).filter((text) => text.trim());
    return [field, { labels: cellLabelSuggestions(texts), read: texts.length }];
  })), [samples, textFields.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestionsFor = (field: string | null): LabelSuggestions | undefined => {
    const found = field ? labelsByField[field] : undefined;
    return found ? { status: 'ready', labels: found.labels, documentsRead: found.read, unit: 'records',
      onPreview: (suggestion) => setHighlight({ text: suggestion.label }) } : undefined;
  };
  const showReading = (id: string | undefined, reading: DocumentFieldReading) => {
    if (id !== undefined) setShownId(id);
    setHighlight({ column: reading.column, span: reading.span, text: reading.span ? undefined : String(reading.value ?? '') });
  };
  const labelCount = highlight?.text && !highlight.span
    ? pickedIds.filter((id) => {
      const record = samples.find((item) => item.id === id);
      return record && textFields.some((field) => String(recordValue(record, field) ?? '').toLocaleLowerCase().includes(highlight.text!.toLocaleLowerCase()));
    }).length : null;

  const refresh = async (revision: number) => {
    useSemanticModelEditorStore.getState().adoptRevision(revision);
    await Promise.all([
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.derivedSources(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.identityRules(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
      client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => semanticModelApi.saveDerivedSource(modelId, {
      conceptId: concept!.id,
      sourceConceptId,
      fieldMappings: payload,
      identityFields: keys,
      conflictRule: rule,
      ...(rule === 'latest' ? { orderBy } : {}),
      // Only limits that were set; none saves the admin's defaults. Kept even while no field uses AI.
      ...(Object.keys(aiSettings).length ? { aiSettings } : {}),
      ...(expandPayload(expand) ? { expand: expandPayload(expand) } : {}),
    }, target?.derived?.id),
    onSuccess: async (result) => {
      await refresh(result.revision);
      showSuccess(t('derived.saved', { concept: concept?.label ?? '', source: source?.label ?? '' }));
      onClose();
    },
    onError: (error) => showError(t('derived.saveError'), { description: parseApiError(error).message }),
  });
  const remove = useMutation({
    mutationFn: () => semanticModelApi.deleteDerivedSource(modelId, target!.derived!.id),
    onSuccess: async (result) => { await refresh(result.revision); onClose(); },
    onError: (error) => showError(t('derived.removeError'), { description: parseApiError(error).message }),
  });

  const changeRows = (next: SourceFieldMapping[]) => setRows(next);
  // A preset is fitted to the source concept: its fields are the "columns" a field reads; one it does not have
  // falls back to the field read now or the same-named one. A recipe reading a column it lacks is flagged to fix.
  const applySettings = (settings: MappingSettings, exact: boolean) => {
    const next = adaptToSheet(settings.fieldMappings, rows, attributes, sourceFields)
      .map((row) => row.mode === 'metadata' ? { sourceField: null, targetAttribute: row.targetAttribute, mode: 'ignore' as const } : row);
    setRows(next);
    const filled = settings.identityFields.filter((key) => next.some((row) => row.mode !== 'ignore' && row.targetAttribute === key));
    if (filled.length || exact) setKeys(filled);
    const { manyRecords: _ignored, ...limits } = settings.aiSettings ?? {};
    setAiSettings(limits);
  };
  const defaultsQuery = useQuery({
    queryKey: ['semantic-models', 'extraction-defaults'],
    queryFn: () => semanticModelApi.getExtractionDefaults(),
    enabled: Boolean(target),
    staleTime: 60_000,
  });
  const toggleKey = (key: string) => setKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const keyLabels = keys.map(attributeLabel).join(', ');
  const busy = save.isPending || remove.isPending;
  const recordCount = samplesQuery.data?.total ?? samples.length;

  return <Sheet modal={false} open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && concept && <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-3xl' onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader className='border-b p-5'>
        <SheetTitle className='flex items-center gap-2'><GitMerge className='h-4 w-4' />{t('derived.title', { concept: concept.label })}</SheetTitle>
        <SheetDescription>{t('derived.description', { concept: concept.label })}</SheetDescription>
      </SheetHeader>
      <ReadingTextContext.Provider value='record'>
      <div className='min-h-0 flex-1 space-y-6 overflow-y-auto p-5'>
        <FormField label={t('derived.source')} htmlFor='derived-source'>
          <Select value={sourceConceptId} onValueChange={(value) => {
            setSourceConceptId(value); setRows(suggestedRows(value)); setOrderBy(''); setExpand(null); setPicked(null); setShownId(null); setHighlight(null);
          }}>
            <SelectTrigger id='derived-source' className={INPUT} aria-label={t('derived.source')}><SelectValue placeholder={t('derived.chooseSource')} /></SelectTrigger>
            <SelectContent>{candidates.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
          </Select>
          {!candidates.length && <p className='text-xs text-muted-foreground'>{t('derived.noCandidate')}</p>}
        </FormField>

        {source && <section className={FORM_SECTION} aria-label={t('derived.samplesTitle')}>
          <SectionHeader title={t('derived.samplesTitle')} help={t('derived.samplesHelp', { max: MAX_RECORDS, source: source.label })} icon={<Rows className='mr-0.5 h-4 w-4 text-muted-foreground' />}>
            <span className='text-[11px] tabular-nums text-muted-foreground'>{t('derived.recordsPicked', { count: pickedIds.length, total: samples.length })}</span>
          </SectionHeader>
          {samplesQuery.isLoading && <div className='flex items-center gap-2 text-xs text-muted-foreground'><Loader2 className='h-3.5 w-3.5 animate-spin' />{t('derived.loadingSamples')}</div>}
          {!samplesQuery.isLoading && !samples.length && <p className='text-xs text-muted-foreground'>{t('derived.noSamples', { source: source.label })}</p>}
          {samples.length > 0 && <div className='grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]'>
            <div className='space-y-1.5'>
              {samples.length > FILTER_FROM && <Input className='h-7 text-xs' value={recordFilter} onChange={(event) => setRecordFilter(event.target.value)}
                placeholder={t('derived.recordsFilter')} aria-label={t('derived.recordsFilter')} />}
              <ul className={cn(ROW_LIST, 'max-h-56 overflow-y-auto text-xs')}>
                {listedSamples.map((record) => {
                  const checked = pickedIds.includes(record.id);
                  return <li key={record.id} className={cn('flex items-center gap-2 px-2 py-1', shown?.id === record.id && 'bg-muted/60')}>
                    <input type='checkbox' checked={checked} disabled={!checked && pickedIds.length >= MAX_RECORDS}
                      aria-label={t('derived.recordFor', { record: record.label || record.id })} onChange={() => togglePicked(record.id)} />
                    <button type='button' className='min-w-0 flex-1 truncate text-left disabled:opacity-60' disabled={!checked}
                      aria-label={t('derived.showRecord', { record: record.label || record.id })} onClick={() => { setShownId(record.id); setHighlight(null); }}>
                      {record.label || record.id}
                    </button>
                  </li>;
                })}
              </ul>
            </div>
            <div className='min-w-0 space-y-2'>
              <div className='flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground' aria-live='polite'>
                {live.loading ? <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin' /> : <Rows className='h-3.5 w-3.5 shrink-0' />}
                <span className='min-w-0 flex-1 truncate'>{!canRead ? t('derived.incomplete') : live.loading ? t('derived.readingRecords', { count: pickedIds.length })
                  : live.result && !stale ? t('derived.readRecords', { count: live.result.records.length }) : usesAi ? t('mapping.live.aiManual') : t('derived.readingRecords', { count: pickedIds.length })}</span>
                {canRead && <Button type='button' size='sm' variant='ghost' className='h-6 shrink-0 px-1.5 text-[11px]' disabled={live.loading} onClick={() => void readRecords()}>
                  <RefreshCw className='mr-1 h-3 w-3' />{usesAi && (!live.result || stale) ? t('derived.readNow') : t('mapping.live.readAgain')}
                </Button>}
              </div>
              {live.error && <p role='alert' className='flex gap-1.5 rounded-lg bg-destructive/10 p-2 text-xs text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{`${t('mapping.previewError')}: ${live.error}`}</p>}
              {highlight?.text && labelCount !== null && <p role='status' className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                <Search className='h-3 w-3 shrink-0' />{t('derived.labelFound', { label: highlight.text, count: labelCount, total: pickedIds.length })}
              </p>}
              {shown && (textFields.length ? textFields : usedFields.slice(0, 3)).map((field) => <div key={field} className='rounded-lg border'>
                <div className='flex items-center justify-between gap-2 border-b bg-muted/30 px-2.5 py-1 text-[11px]'>
                  <span className='truncate font-medium'>{sourceLabels[field] ?? field}</span>
                  <span className='shrink-0 truncate text-muted-foreground'>{shown.label || shown.id}</span>
                </div>
                <ScrollArea className='max-h-48'>
                  <p className='whitespace-pre-wrap break-words px-2.5 py-2 text-xs' aria-label={t('derived.fieldOf', { field: sourceLabels[field] ?? field, record: shown.label || shown.id })}>
                    {markText(String(recordValue(shown, field) ?? ''), highlight ?? foundSpans(shownReadings, field), field)}
                  </p>
                </ScrollArea>
              </div>)}
            </div>
          </div>}
        </section>}

        {source && <ExpandCard value={expand} onChange={setExpand} sourceLabel={source.label}
          sourceFields={source.attributes.map((field) => ({ key: field.key, label: field.label }))}
          relations={(graph?.relations ?? []).filter((relation) => (relation.sourceNodeTypeId === source.id && relation.targetNodeTypeId === concept.id)
            || (relation.sourceNodeTypeId === concept.id && relation.targetNodeTypeId === source.id)).map((relation) => ({ id: relation.id, label: relation.label }))}
          items={expand && live.result && !stale ? { count: live.result.records.length, records: new Set(live.result.records.map((record) => record.entityId)).size,
            truncated: live.result.itemsTruncated === true } : undefined} />}

        {source && <section className={FORM_SECTION}>
          <SectionHeader title={t('derived.fields')} help={t('derived.fieldsHelp', { source: source.label })} count={payload.length || undefined} />
          <MappingPresetBar modelId={modelId} conceptId={concept!.id} attributes={attributes}
            current={{ fieldMappings: payloadRows, aiSettings, identityFields: keys }} onApply={applySettings} autoStart={false} />
          <ReadAllFieldsBar direct mappings={rows} onApply={(choice) => changeRows(readAllWith(rows, choice, 'record'))} />
          {usesAi && <p className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'>
            <Bot className='mt-0.5 h-3.5 w-3.5 shrink-0' />{t('derived.aiEstimate', { calls: Math.min(recordCount, MAX_AI_RECORDS).toLocaleString(), records: recordCount.toLocaleString(), max: MAX_AI_RECORDS, source: source.label })}
          </p>}
          {usesAi && <AiLimitsEditor defaults={defaultsQuery.data?.aiSettings} value={aiSettings} onChange={setAiSettings} />}
          <FieldMappingList kind='record' modelId={modelId} attributes={attributes} mappings={rows} onChange={changeRows}
            onIgnore={(field) => setKeys((current) => current.filter((key) => key !== field))}
            columns={columns} columnLabels={columnLabels}
            columnSamples={shown ? { ...Object.fromEntries(sourceFields.map((field) => [field, String(recordValue(shown, field) ?? '')]).filter(([, value]) => value)),
              ...(itemRows.find((row) => row.__entityId === shown.id) ?? {}) } : undefined}
            recipeSource={{
              kind: 'record', sourceLabel: source.label, columns, columnLabels,
              rows: expand ? itemRows : samples.map((record) => ({ ...Object.fromEntries(sourceFields.map((field) => [field, recordValue(record, field)])), __recordLabel: record.label || record.id })),
              fieldValues,
              fieldInputs: Object.fromEntries(payloadRows.filter((row) => row.mode === 'direct' && row.sourceField).map((row) => [row.targetAttribute, { column: row.sourceField! }])),
            }}
            extras={(mapping) => ({
              live: canRead && shown && (mapping.mode === 'extract' || mapping.mode === 'computed') ? <FieldLiveStatus
                reading={shownReadings?.[mapping.targetAttribute]} pending={live.loading} stale={stale}
                labels={mapping.mode === 'extract' ? mapping.rules?.labels?.length ? mapping.rules.labels : [attributeLabel(mapping.targetAttribute)] : []}
                findLabelText={t('derived.findLabel')}
                onShow={(item) => showReading(shown.id, item)} onFindLabel={(label) => setHighlight({ text: label })} /> : null,
              suggestions: mapping.mode === 'extract' ? suggestionsFor(mapping.sourceField) : undefined,
              reading: canRead && shown ? { reading: shownReadings?.[mapping.targetAttribute], pending: live.loading, onRead: () => void readRecords() } : undefined,
            })} />
        </section>}

        {source && <section className={FORM_SECTION} aria-label={t('derived.keysTitle')}>
          <SectionHeader title={t('derived.keysTitle')} help={t('derived.keysHelp', { concept: concept.label })} icon={<KeyRound className='mr-0.5 h-4 w-4 text-amber-600 dark:text-amber-400' />} />
          <div className='flex flex-wrap gap-1.5'>
            {payload.map((field) => {
              const isKey = keys.includes(field.targetAttribute);
              return <button key={field.targetAttribute} type='button' aria-pressed={isKey} aria-label={t('derived.keyFor', { field: attributeLabel(field.targetAttribute) })}
                className={cn('flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isKey ? 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'text-muted-foreground hover:bg-muted')}
                onClick={() => toggleKey(field.targetAttribute)}>
                <KeyRound className='h-3 w-3' />{attributeLabel(field.targetAttribute)}
              </button>;
            })}
          </div>
          <p className='text-xs text-muted-foreground'>
            {keys.length ? t('derived.keysSummary', { concept: concept.label, fields: keyLabels, source: source.label }) : t('derived.problem.noKey')}
          </p>
        </section>}

        {source && <section className={cn(FORM_SECTION, 'space-y-4')}>
          <FormField label={t('derived.conflict')} help={t(`derived.ruleHelp.${rule}`)} htmlFor='derived-conflict'>
            <Select value={rule} onValueChange={(value: DerivedConflictRule) => setRule(value)}>
              <SelectTrigger id='derived-conflict' className={INPUT}><SelectValue /></SelectTrigger>
              <SelectContent>{CONFLICT_RULES.map((item) => <SelectItem key={item} value={item}>{t(`derived.rule.${item}`)}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          {rule === 'latest' && <FormField label={t('derived.orderBy', { source: source.label })} htmlFor='derived-order'>
            <Select value={orderBy} onValueChange={setOrderBy}>
              <SelectTrigger id='derived-order' className={INPUT}><SelectValue placeholder={t('derived.chooseOrderBy')} /></SelectTrigger>
              <SelectContent>{[...source.attributes].sort((left, right) => Number(right.type === 'date') - Number(left.type === 'date'))
                .map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>}
        </section>}

        {live.result && source && <section className={cn(FORM_SECTION, stale && 'opacity-60')} aria-label={t('derived.resultTitle')}>
          <SectionHeader title={t('derived.resultTitle')} count={live.result.records.length} />
          {live.result.ai.aiCalls > 0 && <p className='text-[11px] text-muted-foreground'>{t('mapping.cell.aiPreview', { count: live.result.ai.aiCalls })}</p>}
          {live.result.records.map((record) => <div key={`${record.entityId}#${record.item ?? 0}`} className='space-y-1.5 rounded-lg border p-2'>
            <button type='button' className='text-xs font-medium hover:underline' onClick={() => { setShownId(record.entityId); setHighlight(null); }}>
              {recordLabel(record.entityId)}{record.item !== undefined ? ` · ${t('derived.expand.itemOf', { number: record.item, item: record.itemText ?? '' })}` : ''}</button>
            <div className='grid gap-1.5 sm:grid-cols-2'>
              {payload.filter((field) => record.fields[field.targetAttribute]).map((field) => {
                const reading = record.fields[field.targetAttribute];
                // The evidence names the source field by its name, and the record it was read on.
                return <Fragment key={field.targetAttribute}>
                  <FieldReadingResult fieldLabel={attributeLabel(field.targetAttribute)}
                    reading={reading.column ? { ...reading, column: `${sourceLabels[reading.column] ?? reading.column} · ${recordLabel(record.entityId)}` } : reading}
                    onOpenQuote={() => showReading(record.entityId, reading)} />
                </Fragment>;
              })}
            </div>
          </div>)}
        </section>}

        {problem && source && <p role='alert' className='text-xs text-amber-700 dark:text-amber-400'>{problem}</p>}
        {fillsAnother && !source && <p role='alert' className='text-xs text-amber-700 dark:text-amber-400'>{problem}</p>}
      </div>
      </ReadingTextContext.Provider>
      <div className='flex items-center gap-2 border-t p-4'>
        {target.derived && <Button variant='outline' className={DELETE_BUTTON} disabled={busy} onClick={() => remove.mutate()}>
          <Trash2 className='mr-1.5 h-4 w-4' />{t('derived.remove')}
        </Button>}
        <div className='flex-1' />
        <Button variant='outline' onClick={onClose} disabled={busy}>{t('action.cancel')}</Button>
        <Button onClick={() => save.mutate()} disabled={Boolean(problem) || busy}>{save.isPending ? t('derived.saving') : t('derived.save')}</Button>
      </div>
    </SheetContent>}
  </Sheet>;
}
