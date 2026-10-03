import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Loader2, RefreshCw, Rows, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { AiExtractionSettings, DocumentFieldReading, MappingSettings, SheetFieldPreviewResponse, SourceFieldMapping } from '../../types';
import type { SuggestionSource } from '../editor/SuggestConceptsDialog';
import { FORM_SECTION, FormField, INPUT, ROW_LIST, SectionHeader } from '../form/FormParts';
import { AiLimitsEditor, FieldReadingResult, limitProblem, ReadAllFieldsBar, rulesProblem, usesAi as mappingsUseAi, usesRules, type LabelSuggestions } from './DocumentFieldRules';
import { FieldLiveStatus } from './DocumentPreviewPane';
import { computedProblem } from './FieldRecipeEditor';
import { FieldMappingList, readAllWith, recipeInputs } from './FieldMappingList';
import { MappingPresetBar } from './MappingPresetBar';
import { adaptToSheet, cellLabelSuggestions, cellValue, newSheetRows, sampleRowNumber, sheetPayload, sheetRows } from './sheetMapping';
import type { SourceMappingTarget } from './SourceMappingDrawer';

// Sample rows read for the fields until the person picks others, and at most.
const DEFAULT_ROWS = 5;
const MAX_ROWS = 20;
// The runtime's default bound on rows read with AI per source and run (SEMANTIC_MAX_AI_ROWS_PER_SOURCE).
const MAX_AI_ROWS = 500;

type Span = { start: number; end: number };
type Highlight = { text?: string; column?: string; span?: Span | null; spans?: Span[] } | null;

/** Without a highlight asked for, the values the shown row gave are marked in the cell they were found in. */
function foundSpans(readings: Record<string, DocumentFieldReading> | undefined, column: string): Highlight {
  const spans = Object.values(readings ?? {}).filter((reading) => reading.reason === 'found' && reading.column === column && reading.span)
    .map((reading) => reading.span!).sort((left, right) => left.start - right.start)
    .filter((span, index, all) => index === 0 || span.start >= all[index - 1].end);
  return spans.length ? { column, spans } : null;
}

/**
 * A spreadsheet's (or an e-mail archive table's) mapping, with the same field mapping as documents: each
 * concept field is read from a column as it is, or out of the column's cell text with the document rules
 * and/or AI, or taken from a column or another field, or fixed. Picked sample rows are read as a run would.
 */
export function SheetSourceMappingDrawer({ modelId, target, onClose, onSuggestConcepts }: Readonly<{
  modelId: string; target: SourceMappingTarget | null; onClose: () => void; onSuggestConcepts?: (source: SuggestionSource) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const nodes = useMemo(() => graph?.nodes.filter((node) => !node.systemKey) ?? [], [graph]);
  const sourceMappings = useSourceMappings(modelId).data ?? [];
  const [conceptId, setConceptId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [mappings, setMappings] = useState<SourceFieldMapping[]>([]);
  const [identityField, setIdentityField] = useState('');
  const [aiSettings, setAiSettings] = useState<Partial<AiExtractionSettings>>({});
  const [picked, setPicked] = useState<number[] | null>(null);
  const [shownRow, setShownRow] = useState<number | null>(null);
  const [rowFilter, setRowFilter] = useState('');
  const [highlight, setHighlight] = useState<Highlight>(null);

  useEffect(() => {
    if (!target) return;
    setConceptId(target.mapping?.conceptId ?? target.conceptId ?? '');
    setSheetName(target.mapping?.sheetName ?? '');
    setMappings([]);
    setIdentityField(target.mapping?.identityFields[0] ?? '');
    setAiSettings({ ...target.mapping?.aiSettings });
    setPicked(null);
    setShownRow(null);
    setHighlight(null);
    preview.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.workspaceId, target?.documentId, target?.mapping?.id]);

  const defaultsQuery = useQuery({
    queryKey: ['semantic-models', 'extraction-defaults'],
    queryFn: () => semanticModelApi.getExtractionDefaults(),
    enabled: Boolean(target),
    staleTime: 60_000,
  });
  const profile = useQuery({
    queryKey: semanticModelQueryKeys.sourceAssetProfile(modelId, target?.documentId ?? 'none', sheetName || undefined),
    queryFn: () => semanticModelApi.profileSourceAsset(modelId, target!.documentId, target!.workspaceId, sheetName || undefined),
    enabled: Boolean(target),
  });
  const analyze = useMutation({
    mutationFn: () => semanticModelApi.analyzeSourceAsset(modelId, target!.documentId, target!.workspaceId, sheetName || undefined),
    onSuccess: (data) => client.setQueryData(semanticModelQueryKeys.sourceAssetProfile(modelId, target!.documentId, sheetName || undefined), data),
    onError: (error) => showError(t('sourceAnalysis.error'), { description: parseApiError(error).message }),
  });
  // A spreadsheet is usable as soon as it is uploaded: when it has not been read yet, read it now.
  const readKey = `${target?.documentId ?? ''}|${sheetName}`;
  const [autoRead, setAutoRead] = useState('');
  const unread = profile.isError || (profile.data && !profile.data.sheets.length && !sheetName);
  useEffect(() => {
    if (!target || !unread || analyze.isPending || autoRead === readKey) return;
    setAutoRead(readKey);
    analyze.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, readKey]);
  const reading = profile.isLoading || analyze.isPending;

  const fields = useMemo(() => sheetName ? profile.data?.fields ?? [] : [], [sheetName, profile.data]);
  const columns = useMemo(() => fields.map((field) => field.name), [fields]);
  const columnSamples = useMemo(() => Object.fromEntries(fields.map((field) => [field.name, field.sample])), [fields]);
  const concept = nodes.find((node) => node.id === conceptId);
  const attributes = useMemo(() => concept?.attributes ?? [], [concept]);
  const attributeLabel = (key: string) => attributes.find((attribute) => attribute.key === key)?.label ?? key;
  const savedOrder = useMemo(() => (target?.mapping?.fieldMappings ?? []).filter((mapping) => mapping.mode !== 'ignore').map((mapping) => mapping.targetAttribute), [target?.mapping]);

  // One row per concept field: a saved mapping's rows as saved, a new one's from the columns named like the fields.
  const buildKey = `${target?.mapping?.id ?? 'new'}|${conceptId}|${sheetName}|${attributes.map((attribute) => attribute.key).join(',')}|${target?.mapping ? '' : columns.join('|')}`;
  useEffect(() => {
    if (!target || !conceptId || !sheetName) return;
    if (target.mapping) { setMappings(sheetRows(target.mapping.fieldMappings, attributes)); return; }
    if (!columns.length) return;
    const rows = newSheetRows(attributes, columns);
    setMappings(rows);
    const existing = sourceMappings.find((mapping) => mapping.conceptId === conceptId)?.identityFields[0];
    const candidate = fields.find((field) => field.uniqueRatio === 1 && field.populatedRatio === 1
      && rows.some((row) => row.mode === 'direct' && row.sourceField === field.name));
    setIdentityField(existing && rows.some((row) => row.mode !== 'ignore' && row.targetAttribute === existing) ? existing
      : rows.find((row) => row.sourceField === candidate?.name && row.mode === 'direct')?.targetAttribute ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey]);

  const payload = useMemo(() => sheetPayload(mappings, savedOrder), [mappings, savedOrder]);
  const usesAi = mappingsUseAi(payload);
  const changeMappings = (next: SourceFieldMapping[]) => { setMappings(next); preview.reset(); };

  // What blocks saving, field by field.
  const problems = payload.filter((mapping) => {
    if ((mapping.mode === 'direct' || mapping.mode === 'extract') && !mapping.sourceField) return true;
    if (mapping.mode === 'extract' && usesRules(mapping.extractionStrategy) && rulesProblem(mapping.rules)) return true;
    if (mapping.mode === 'computed') return Boolean(computedProblem(mapping.computed, recipeInputs(payload, mapping.targetAttribute, 'sheet'), columns.length ? columns : undefined));
    return false;
  }).map((mapping) => mapping.targetAttribute);
  const identityValid = !identityField || payload.some((mapping) => mapping.targetAttribute === identityField);
  const limitsValid = !usesAi || !limitProblem(aiSettings);
  const canSave = Boolean(conceptId && sheetName && payload.length && identityValid && !problems.length && limitsValid);

  // Sample rows: the bounded rows the source analysis kept, numbered as in the sheet.
  const samples = useMemo(() => (profile.data?.sampleRows ?? []).map((row, index) => ({ number: sampleRowNumber(row, index), row })), [profile.data]);
  const pickedNumbers = (picked ?? samples.slice(0, DEFAULT_ROWS).map((item) => item.number)).filter((number) => samples.some((item) => item.number === number));
  const shown = samples.find((item) => item.number === shownRow && pickedNumbers.includes(item.number)) ?? samples.find((item) => item.number === pickedNumbers[0]);
  const togglePicked = (number: number) => {
    const next = pickedNumbers.includes(number) ? pickedNumbers.filter((item) => item !== number)
      : pickedNumbers.length < MAX_ROWS ? [...pickedNumbers, number].sort((left, right) => left - right) : pickedNumbers;
    setPicked(next);
  };
  // The columns the fields read, sent for the picked rows; those read out of a cell are shown beside the fields.
  const usedColumns = [...new Set(payload.flatMap((mapping) => [mapping.sourceField ?? '', mapping.computed?.input.kind === 'column' ? mapping.computed.input.name : '']).filter(Boolean))];
  const textColumns = [...new Set(payload.filter((mapping) => mapping.mode === 'extract' && mapping.sourceField).map((mapping) => mapping.sourceField!))];
  const canRead = canSave && pickedNumbers.length > 0;
  const draftKey = canRead ? JSON.stringify([payload, pickedNumbers, usesAi ? aiSettings : null, conceptId]) : '';
  const requestRef = useRef<() => Parameters<typeof semanticModelApi.previewSheetFields>[1]>();
  requestRef.current = () => ({
    conceptId, workspaceId: target!.workspaceId, documentId: target!.documentId, fieldMappings: payload,
    rows: pickedNumbers.map((number) => {
      const row = samples.find((item) => item.number === number)?.row ?? {};
      return { rowNumber: number, values: Object.fromEntries(usedColumns.map((column) => [column, cellValue(row[column])])) };
    }),
    ...(usesAi ? { aiSettings } : {}),
  });
  const [live, setLive] = useState<{ key: string; result?: SheetFieldPreviewResponse; error?: string; loading: boolean }>({ key: '', loading: false });
  const liveKey = useRef('');
  const readRows = useCallback(async () => {
    const key = draftKey;
    if (!key || !requestRef.current) return;
    liveKey.current = key;
    setLive((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const result = await semanticModelApi.previewSheetFields(modelId, requestRef.current());
      if (liveKey.current === key) setLive({ key, result, loading: false });
    } catch (error) {
      if (liveKey.current === key) setLive((current) => ({ ...current, key, error: parseApiError(error).message, loading: false }));
    }
  }, [draftKey, modelId]);
  // Rules and columns are read again as they change; AI only on request (it is slow and costly).
  useEffect(() => {
    if (!draftKey || usesAi) return;
    const timer = setTimeout(() => void readRows(), 500);
    return () => clearTimeout(timer);
  }, [draftKey, usesAi, readRows]);
  const stale = Boolean(live.result) && live.key !== draftKey;
  const readingsOf = (number?: number) => live.result?.rows.find((row) => row.rowNumber === number)?.fields;
  const shownReadings = readingsOf(shown?.number);
  const fieldValues = useMemo(() => Object.fromEntries(attributes.map((attribute) => [attribute.key, (live.result?.rows ?? []).flatMap((row) => {
    const reading = row.fields[attribute.key];
    return reading?.reason === 'found' && reading.value != null ? [{ row: row.rowNumber, value: String(reading.value) }] : [];
  })])), [attributes, live.result]);

  // Labels starting lines in each column's cells, offered as labels a value follows.
  const labelsByColumn = useMemo(() => Object.fromEntries(textColumns.map((column) => {
    const texts = samples.map((item) => String(item.row[column] ?? '')).filter((text) => text.trim());
    return [column, { labels: cellLabelSuggestions(texts), read: texts.length }];
  })), [samples, textColumns.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestionsFor = (column: string | null): LabelSuggestions | undefined => {
    const found = column ? labelsByColumn[column] : undefined;
    return found ? { status: 'ready', labels: found.labels, documentsRead: found.read, unit: 'cells',
      onPreview: (suggestion) => setHighlight({ text: suggestion.label }) } : undefined;
  };
  const labelCount = highlight?.text && !highlight.span
    ? pickedNumbers.filter((number) => {
      const row = samples.find((item) => item.number === number)?.row ?? {};
      return textColumns.some((column) => String(row[column] ?? '').toLocaleLowerCase().includes(highlight.text!.toLocaleLowerCase()));
    }).length : null;
  const showReading = (number: number | undefined, reading: DocumentFieldReading) => {
    if (number !== undefined) setShownRow(number);
    setHighlight({ column: reading.column, span: reading.span, text: reading.span ? undefined : String(reading.value ?? '') });
  };

  const preview = useMutation({
    mutationFn: () => semanticModelApi.previewSourceMapping(modelId, {
      conceptId, workspaceId: target!.workspaceId, documentId: target!.documentId, sheetName, assetKind: target!.assetKind,
      fieldMappings: payload, identityFields: identityField ? [identityField] : [],
    }),
    onError: (error) => showError(t('mapping.previewError'), { description: error instanceof Error ? error.message : undefined }),
  });
  const save = useMutation({
    mutationFn: () => semanticModelApi.createSourceMapping(modelId, {
      conceptId, workspaceId: target!.workspaceId, documentId: target!.documentId, sheetName, assetKind: target!.assetKind,
      fieldMappings: payload, identityFields: identityField ? [identityField] : [],
      ...(usesAi ? { aiSettings } : {}),
    }),
    onSuccess: async (result) => {
      // The mapping command advanced the model revision; adopt it so the next autosave does not conflict.
      useSemanticModelEditorStore.getState().adoptRevision(result.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.sourceMappings(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.mappingHealth(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.freshness(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('mapping.saved', { name: target!.documentName }));
      onClose();
    },
    onError: (error) => showError(t('mapping.saveError'), { description: error instanceof Error ? error.message : undefined }),
  });

  const applySettings = (settings: MappingSettings, exact: boolean) => {
    const rows = adaptToSheet(settings.fieldMappings, mappings, attributes, columns);
    changeMappings(rows);
    const identity = settings.identityFields.find((key) => rows.some((row) => row.mode !== 'ignore' && row.targetAttribute === key));
    if (identity || exact) setIdentityField(identity ?? '');
    setAiSettings({ ...settings.aiSettings });
  };
  const rowCount = profile.data?.sheet?.rowCount || profile.data?.totalRows || samples.length;
  const listedSamples = rowFilter.trim()
    ? samples.filter((item) => usedColumns.some((column) => String(item.row[column] ?? '').toLocaleLowerCase().includes(rowFilter.trim().toLocaleLowerCase())))
    : samples;

  return <Sheet modal={false} open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {target && <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-3xl' onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader className='border-b p-5'>
        <SheetTitle>{target.mapping ? t('mapping.editTitle') : t('mapping.title', { name: target.documentName })}</SheetTitle>
        <SheetDescription>{t('mapping.description')}</SheetDescription>
        {onSuggestConcepts && !target.mapping && (target.assetKind === 'excel_sheet' || target.assetKind === 'csv') && <Button size='sm' variant='outline' className='mt-2 w-fit'
          onClick={() => onSuggestConcepts({ workspaceId: target.workspaceId, documentId: target.documentId, documentName: target.documentName, assetKind: target.assetKind as SuggestionSource['assetKind'] })}>
          <Sparkles className='mr-2 h-4 w-4' />{t('suggest.openFromFile')}</Button>}
      </SheetHeader>
      <div className='min-h-0 flex-1 space-y-6 overflow-y-auto p-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField label={t('mapping.concept')}>
            <Select value={conceptId} disabled={Boolean(target.mapping)} onValueChange={(value) => {
              setConceptId(value); setMappings([]);
              setIdentityField(sourceMappings.find((mapping) => mapping.conceptId === value)?.identityFields[0] ?? ''); preview.reset();
            }}>
              <SelectTrigger className={INPUT} aria-label={t('mapping.concept')}><SelectValue placeholder={t('mapping.chooseConcept')} /></SelectTrigger>
              <SelectContent>{nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label={t('mapping.sheet')}>
            <Select value={sheetName} disabled={Boolean(target.mapping)} onValueChange={(value) => { setSheetName(value); setMappings([]); setIdentityField(''); setPicked(null); preview.reset(); }}>
              <SelectTrigger className={INPUT} aria-label={t('mapping.sheet')}><SelectValue placeholder={t('mapping.chooseSheet')} /></SelectTrigger>
              <SelectContent>{(profile.data?.sheets ?? []).map((sheet) => <SelectItem key={sheet.name} value={sheet.name}>
                {sheet.name}{sheet.rowCount || sheet.fieldCount ? ` · ${t('mapping.sheetMeta', { rows: sheet.rowCount, fields: sheet.fieldCount })}` : ''}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </div>
        {reading && <div className='flex items-center gap-2 text-xs text-muted-foreground'><Loader2 className='h-3.5 w-3.5 animate-spin' />{t('sourceAnalysis.loading')}</div>}
        {/* Shown once the file was read and still gave no sheets, or reading it failed. */}
        {!reading && unread && (analyze.isError || autoRead === readKey) && <div className='flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-xs text-destructive'>
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' /><span className='min-w-0 flex-1'>{t('sourceAnalysis.readFailed')}</span>
          <Button size='sm' variant='ghost' className='h-6 shrink-0 px-2 text-[11px]' disabled={analyze.isPending} onClick={() => analyze.mutate()}>
            {analyze.isPending ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}{t('sourceAnalysis.retry')}</Button>
        </div>}

        {sheetName && concept && <section className={FORM_SECTION} aria-label={t('mapping.cell.samplesTitle')}>
          <SectionHeader title={t('mapping.cell.samplesTitle')} help={t('mapping.cell.samplesHelp', { max: MAX_ROWS })} icon={<Rows className='mr-0.5 h-4 w-4 text-muted-foreground' />}>
            <span className='text-[11px] tabular-nums text-muted-foreground'>{t('mapping.cell.rowsPicked', { count: pickedNumbers.length, total: samples.length })}</span>
          </SectionHeader>
          {profile.data && !profile.data.complete && <p className='text-xs text-amber-700 dark:text-amber-400'>{t('sourceAnalysis.boundedSample')}</p>}
          {!samples.length && <p className='text-xs text-muted-foreground'>{t('mapping.cell.noSamples')}</p>}
          {samples.length > 0 && <div className='grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]'>
            <div className='space-y-1.5'>
              {samples.length > 8 && <Input className='h-7 text-xs' value={rowFilter} onChange={(event) => setRowFilter(event.target.value)}
                placeholder={t('mapping.recipe.rowsFilter')} aria-label={t('mapping.recipe.rowsFilter')} />}
              <ul className={cn(ROW_LIST, 'max-h-56 overflow-y-auto text-xs')}>
                {listedSamples.map((item) => {
                  const checked = pickedNumbers.includes(item.number);
                  const summary = usedColumns.map((column) => String(item.row[column] ?? '')).find((text) => text.trim()) ?? '';
                  return <li key={item.number} className={cn('flex items-center gap-2 px-2 py-1', shown?.number === item.number && 'bg-muted/60')}>
                    <input type='checkbox' checked={checked} disabled={!checked && pickedNumbers.length >= MAX_ROWS}
                      aria-label={t('mapping.recipe.rowFor', { row: t('mapping.recipe.rowLabel', { row: item.number }) })} onChange={() => togglePicked(item.number)} />
                    <button type='button' className='flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:opacity-60' disabled={!checked}
                      aria-label={t('mapping.cell.showRow', { row: item.number })} onClick={() => { setShownRow(item.number); setHighlight(null); }}>
                      <span className='shrink-0 tabular-nums text-muted-foreground'>{t('mapping.recipe.rowLabel', { row: item.number })}</span>
                      <span className='min-w-0 truncate'>{summary || '—'}</span>
                    </button>
                  </li>;
                })}
              </ul>
            </div>
            <div className='min-w-0 space-y-2'>
              <div className='flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground' aria-live='polite'>
                {live.loading ? <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin' /> : <Rows className='h-3.5 w-3.5 shrink-0' />}
                <span className='min-w-0 flex-1 truncate'>{!canRead ? t('mapping.cell.incomplete') : live.loading ? t('mapping.cell.readingRows', { count: pickedNumbers.length })
                  : live.result && !stale ? t('mapping.cell.readRows', { count: live.result.rows.length }) : usesAi ? t('mapping.live.aiManual') : t('mapping.cell.readingRows', { count: pickedNumbers.length })}</span>
                {canRead && <Button type='button' size='sm' variant='ghost' className='h-6 shrink-0 px-1.5 text-[11px]' disabled={live.loading} onClick={() => void readRows()}>
                  <RefreshCw className='mr-1 h-3 w-3' />{usesAi && (!live.result || stale) ? t('mapping.cell.readNow') : t('mapping.live.readAgain')}
                </Button>}
              </div>
              {live.error && <p role='alert' className='flex gap-1.5 rounded-lg bg-destructive/10 p-2 text-xs text-destructive'><AlertTriangle className='h-3.5 w-3.5 shrink-0' />{`${t('mapping.previewError')}: ${live.error}`}</p>}
              {highlight?.text && labelCount !== null && <p role='status' className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                <Search className='h-3 w-3 shrink-0' />{t('mapping.cell.labelFound', { label: highlight.text, count: labelCount, total: pickedNumbers.length })}
              </p>}
              {shown && (textColumns.length ? textColumns : usedColumns.slice(0, 3)).map((column) => <div key={column} className='rounded-lg border'>
                <div className='flex items-center justify-between gap-2 border-b bg-muted/30 px-2.5 py-1 text-[11px]'>
                  <span className='truncate font-medium'>{column}</span>
                  <span className='shrink-0 tabular-nums text-muted-foreground'>{t('mapping.recipe.rowLabel', { row: shown.number })}</span>
                </div>
                <ScrollArea className='max-h-48'>
                  <p className='whitespace-pre-wrap break-words px-2.5 py-2 text-xs' aria-label={t('mapping.cell.cellOf', { column, row: shown.number })}>
                    {markText(String(shown.row[column] ?? ''), highlight ?? foundSpans(shownReadings, column), column)}
                  </p>
                </ScrollArea>
              </div>)}
            </div>
          </div>}
        </section>}

        {sheetName && concept && attributes.length > 0 && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.cell.fieldsTitle')} help={t('mapping.cell.fieldsHelp')} count={payload.length || undefined} />
          <MappingPresetBar modelId={modelId} conceptId={conceptId} attributes={attributes}
            current={{ fieldMappings: payload, aiSettings, identityFields: identityField ? [identityField] : [] }} onApply={applySettings} autoStart={false} />
          <ReadAllFieldsBar direct mappings={mappings} onApply={(choice) => changeMappings(readAllWith(mappings, choice, 'sheet'))} />
          {usesAi && <p className='flex gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'>
            <Bot className='mt-0.5 h-3.5 w-3.5 shrink-0' />{t('mapping.cell.aiEstimate', { calls: Math.min(rowCount, MAX_AI_ROWS).toLocaleString(), rows: rowCount.toLocaleString(), max: MAX_AI_ROWS })}
          </p>}
          <FieldMappingList kind='sheet' modelId={modelId} attributes={attributes} mappings={mappings} onChange={changeMappings}
            onIgnore={(field) => { if (identityField === field) setIdentityField(''); }}
            columns={columns} columnSamples={columnSamples}
            recipeSource={{
              kind: 'sheet', columns, rows: profile.data?.sampleRows ?? [], fieldValues,
              fieldInputs: Object.fromEntries(payload.filter((mapping) => mapping.mode === 'direct' && mapping.sourceField)
                .map((mapping) => [mapping.targetAttribute, { column: mapping.sourceField! }])),
            }}
            extras={(mapping) => ({
              live: canRead && shown && (mapping.mode === 'extract' || mapping.mode === 'computed') ? <FieldLiveStatus
                reading={shownReadings?.[mapping.targetAttribute]} pending={live.loading} stale={stale}
                labels={mapping.mode === 'extract' ? mapping.rules?.labels?.length ? mapping.rules.labels : [attributeLabel(mapping.targetAttribute)] : []}
                findLabelText={t('mapping.cell.findLabel')}
                onShow={(item) => showReading(shown.number, item)} onFindLabel={(label) => setHighlight({ text: label })} /> : null,
              suggestions: mapping.mode === 'extract' ? suggestionsFor(mapping.sourceField) : undefined,
              reading: canRead && shown ? { reading: shownReadings?.[mapping.targetAttribute], pending: live.loading, onRead: () => void readRows() } : undefined,
            })} />
          {usesAi && <AiLimitsEditor defaults={defaultsQuery.data?.aiSettings} value={aiSettings} onChange={(next) => { setAiSettings(next); preview.reset(); }} />}
          {problems.length > 0 && <p role='status' className='text-xs text-amber-700 dark:text-amber-400'>{t('mapping.cell.saveBlocked', { fields: problems.map(attributeLabel).join(', ') })}</p>}
        </section>}

        {sheetName && concept && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.identity')} help={t('mapping.identityHelp')} />
          <Select value={identityField || '__none'} onValueChange={(value) => setIdentityField(value === '__none' ? '' : value)}>
            <SelectTrigger className={INPUT} aria-label={t('mapping.identity')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='__none'>{t('mapping.identityNone')}</SelectItem>
              {payload.map((mapping) => <SelectItem key={mapping.targetAttribute} value={mapping.targetAttribute}>{attributeLabel(mapping.targetAttribute)}</SelectItem>)}
            </SelectContent>
          </Select>
          {preview.data?.identityEvidence.map((evidence) => <p key={evidence.name} className='text-xs text-muted-foreground'>
            {t('mapping.identityEvidence', { name: evidence.name, unique: Math.round(evidence.uniqueRatio * 100), populated: Math.round(evidence.populatedRatio * 100) })}
          </p>)}
        </section>}

        {live.result && concept && <section className={cn(FORM_SECTION, stale && 'opacity-60')} aria-label={t('mapping.cell.resultTitle')}>
          <SectionHeader title={t('mapping.cell.resultTitle')} count={live.result.rows.length} />
          {live.result.ai.aiCalls > 0 && <p className='text-[11px] text-muted-foreground'>{t('mapping.cell.aiPreview', { count: live.result.ai.aiCalls })}</p>}
          {live.result.rows.map((row) => <div key={row.rowNumber} className='space-y-1.5 rounded-lg border p-2'>
            <button type='button' className='text-xs font-medium hover:underline' onClick={() => { setShownRow(row.rowNumber); setHighlight(null); }}>
              {t('mapping.recipe.rowLabel', { row: row.rowNumber })}</button>
            <div className='grid gap-1.5 sm:grid-cols-2'>
              {payload.filter((mapping) => row.fields[mapping.targetAttribute]).map((mapping) => <Fragment key={mapping.targetAttribute}>
                <FieldReadingResult fieldLabel={attributeLabel(mapping.targetAttribute)} reading={row.fields[mapping.targetAttribute]}
                  onOpenQuote={() => showReading(row.rowNumber, row.fields[mapping.targetAttribute])} />
              </Fragment>)}
            </div>
          </div>)}
        </section>}

        {preview.data && <section className={FORM_SECTION}>
          <SectionHeader title={t('mapping.preview', { count: preview.data.stats.resolvedEntities })} />
          {preview.data.warnings.map((warning) => <p key={warning} className='flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400'><AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />{warning}</p>)}
          <ScrollArea className='max-h-56 rounded-lg border'>
            <div className='divide-y'>
              {preview.data.entities.map((entity) => <div key={entity.entityKey} className='px-3 py-2'>
                <p className='truncate text-sm font-medium'>{entity.label || t('mapping.unnamedEntity')}</p>
                <p className='truncate text-[11px] text-muted-foreground'>{Object.entries(entity.values).filter(([key]) => key !== entity.label).slice(0, 4).map(([key, value]) => `${key}: ${String(value ?? '')}`).join(' · ')}</p>
                <p className='text-[11px] text-muted-foreground'>{t('mapping.provenance', { row: entity.provenance.rowNumber })}</p>
              </div>)}
              {!preview.data.entities.length && <p className='p-3 text-xs text-muted-foreground'>{t('mapping.noEntities')}</p>}
            </div>
          </ScrollArea>
        </section>}
      </div>
      <Separator />
      <div className='flex items-center justify-end gap-2 p-4'>
        <Button variant='outline' onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant='outline' disabled={!canSave || preview.isPending} onClick={() => preview.mutate()}>
          {preview.isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}{t('mapping.previewButton')}
        </Button>
        <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}{t('mapping.save')}
        </Button>
      </div>
    </SheetContent>}
  </Sheet>;
}

/** The cell's text with what was found (a span of this column) or a searched label marked. */
function markText(text: string, highlight: Highlight, column: string): ReactNode {
  if (!text) return '—';
  const spans = highlight?.span ? [highlight.span] : highlight?.spans ?? [];
  if (spans.length && highlight?.column === column && spans.every((span) => span.end <= text.length)) {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const { start, end } of spans) {
      parts.push(text.slice(at, start), <mark key={start} className='rounded bg-amber-300/60 px-0.5 dark:bg-amber-500/40'>{text.slice(start, end)}</mark>);
      at = end;
    }
    parts.push(text.slice(at));
    return parts;
  }
  const needle = highlight?.text?.trim();
  if (!needle || (highlight?.column && highlight.column !== column)) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLocaleLowerCase();
  const wanted = needle.toLocaleLowerCase();
  let at = 0;
  for (let found = lower.indexOf(wanted); found >= 0 && parts.length < 200; found = lower.indexOf(wanted, found + wanted.length)) {
    parts.push(text.slice(at, found), <mark key={found} className='rounded bg-amber-300/60 px-0.5 dark:bg-amber-500/40'>{text.slice(found, found + wanted.length)}</mark>);
    at = found + wanted.length;
  }
  parts.push(text.slice(at));
  return parts;
}
