import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, FilterX, FolderOpen, GitBranch, Loader2, RefreshCw, Search, Sheet, Table2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useDerivedSources, useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptRecordsPage, ConceptSourceMapping, SemanticNodeType } from '../../types';
import { valueReadingParts, type ValueReadingKey } from '../../utils/value-reading';

const PAGE_SIZE = 50;
const HEIGHT_KEY = 'semantic-model.records-panel-height';
const WIDTHS_KEY = 'semantic-model.records-columns';
const MIN_HEIGHT = 180;
const DEFAULT_HEIGHT = 320;
const MIN_WIDTH = 64;
const MAX_WIDTH = 900;
/** The record name column, and its filter key (the runtime filters the label by it). */
const NAME = '__label__';
const SOURCE = '__source__';
const DEFAULT_WIDTHS: Record<string, number> = { [NAME]: 200, [SOURCE]: 180 };
const DEFAULT_WIDTH = 160;
/** Longer values (a body, a file's text) open whole in a reader instead of a tooltip. */
const LONG_VALUE = 200;

/** A value read in full: a body or an attached file's text, too long for a cell. */
interface LongText { record: string; field: string; text: string }

type RecordRow = ConceptRecordsPage['records'][number];
type ValueOrigin = RecordRow['provenance'][string];

function storedHeight() {
  try { const saved = Number(window.localStorage.getItem(HEIGHT_KEY)); return saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT; } catch { return DEFAULT_HEIGHT; }
}

function storedWidths(key: string): Record<string, number> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(`${WIDTHS_KEY}.${key}`) ?? '{}') as unknown;
    if (!saved || typeof saved !== 'object') return {};
    return Object.fromEntries(Object.entries(saved).filter(([, width]) => typeof width === 'number' && width >= MIN_WIDTH && width <= MAX_WIDTH));
  } catch { return {}; }
}

/** Where one value came from, in words: "customers.xlsx · Sheet1 · row 4", or who fixed it. */
function originText(origin: ValueOrigin | undefined, t: (key: 'records.table.row' | 'records.table.page' | 'records.table.typed' | 'records.table.fixedBy' | ValueReadingKey, options?: Record<string, string | number | boolean | null | undefined>) => string, concepts: SemanticNodeType[] = []) {
  if (!origin) return '';
  if (origin.correction) return t('records.table.fixedBy', { name: origin.correction.correctedBy || '—' });
  if (origin.source.kind === 'manual') return t('records.table.typed');
  const parts = [origin.source.documentName, origin.source.sheetName].filter(Boolean) as string[];
  if (origin.rowNumber !== undefined) parts.push(t('records.table.row', { row: origin.rowNumber }));
  else if (origin.field?.page) parts.push(t('records.table.page', { page: origin.field.page }));
  const built = valueReadingParts(origin.field, t, (id) => concepts.find((node) => node.id === id)?.label,
    (id, key) => concepts.find((node) => node.id === id)?.attributes.find((attribute) => attribute.key === key)?.label || key);
  return [parts.join(' · '), built.join(' · ')].filter(Boolean).join('\n');
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The records a concept holds in the data in use, as a table under the canvas: every field, searchable and
 * filterable per column, a page at a time, with where each value came from. Columns resize by dragging
 * their right edge (remembered per concept); the top edge drags to make the table taller. "Refresh" reads
 * the concept's sources again while every other concept keeps its data.
 */
export function ConceptRecordsPanel({ modelId, conceptId, onClose, onOpenSource, onRefresh, refreshing = false }: Readonly<{
  modelId: string;
  conceptId: string;
  onClose: () => void;
  onOpenSource?: (mapping: ConceptSourceMapping) => void;
  /** Read this concept's sources again; absent when the person cannot run the model. */
  onRefresh?: () => void;
  /** A run of the model is under way (this refresh or another). */
  refreshing?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const concept = useSemanticModelEditorStore((state) => state.graph?.nodes.find((node) => node.id === conceptId));
  const concepts = useSemanticModelEditorStore((state) => state.graph?.nodes) ?? [];
  const typedCount = useSemanticModelEditorStore((state) => state.graph?.records.filter((record) => record.nodeTypeId === conceptId).length ?? 0);
  const mappings = (useSourceMappings(modelId).data ?? []).filter((mapping) => mapping.conceptId === conceptId);
  // A concept filled from another concept's records: refreshing makes it again from that concept's data.
  const madeFrom = (useDerivedSources(modelId).data ?? []).filter((source) => source.conceptId === conceptId)
    .map((source) => concepts.find((node) => node.id === source.sourceConceptId)?.label ?? source.sourceConceptId);
  const [search, setSearch] = useState('');
  const [reading, setReading] = useState<LongText | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [height, setHeight] = useState(storedHeight);
  const heightRef = useRef(height);
  const widthsKey = `${modelId}.${conceptId}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => storedWidths(widthsKey));
  const widthsRef = useRef(widths);

  useEffect(() => {
    setSearch(''); setQuery(''); setFilters({}); setAppliedFilters({}); setPage(0);
    widthsRef.current = storedWidths(widthsKey);
    setWidths(widthsRef.current);
  }, [conceptId, widthsKey]);
  // Search and filter as the person types, without a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setAppliedFilters(Object.fromEntries(Object.entries(filters).map(([key, text]) => [key, text.trim()]).filter(([, text]) => text)));
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, filters]);

  const records = useQuery({
    queryKey: ['semantic-models', 'concept-records', modelId, conceptId, query, appliedFilters, page],
    queryFn: () => semanticModelApi.conceptRecords(modelId, conceptId, { q: query || undefined, filters: appliedFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = records.data;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const columns = useMemo(() => concept?.attributes ?? [], [concept?.attributes]);
  const narrowed = Boolean(query) || Object.keys(appliedFilters).length > 0;
  const filtering = Object.values(filters).some((text) => text.trim());
  const widthOf = (key: string) => widths[key] ?? DEFAULT_WIDTHS[key] ?? DEFAULT_WIDTH;
  const tableWidth = widthOf(NAME) + columns.reduce((sum, column) => sum + widthOf(column.key), 0) + widthOf(SOURCE);

  const resizeTo = (next: number) => {
    const max = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.75));
    heightRef.current = Math.min(max, Math.max(MIN_HEIGHT, Math.round(next)));
    setHeight(heightRef.current);
  };
  const remember = () => { try { window.localStorage.setItem(HEIGHT_KEY, String(heightRef.current)); } catch { /* a convenience only */ } };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightRef.current;
    const move = (moveEvent: PointerEvent) => resizeTo(startHeight + startY - moveEvent.clientY);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); remember(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    resizeTo(heightRef.current + (event.key === 'ArrowUp' ? 32 : -32));
    remember();
  };

  const setColumnWidth = (key: string, width: number | null) => {
    const next = { ...widthsRef.current };
    if (width === null) delete next[key];
    else next[key] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    widthsRef.current = next;
    setWidths(next);
  };
  const rememberWidths = () => { try { window.localStorage.setItem(`${WIDTHS_KEY}.${widthsKey}`, JSON.stringify(widthsRef.current)); } catch { /* a convenience only */ } };
  const startColumnResize = (key: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(key);
    const move = (moveEvent: PointerEvent) => setColumnWidth(key, startWidth + moveEvent.clientX - startX);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); rememberWidths(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const resizeColumnWithKeys = (key: string, event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setColumnWidth(key, widthOf(key) + (event.key === 'ArrowRight' ? 16 : -16));
    rememberWidths();
  };

  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const headers = [
    { key: NAME, label: t('records.table.name'), filterable: true },
    ...columns.map((column) => ({ key: column.key, label: column.label || column.key, filterable: true })),
    { key: SOURCE, label: t('records.table.source'), filterable: false },
  ];

  return <section aria-label={t('records.table.title', { name: concept?.label ?? '' })} style={{ height }}
    className='relative flex shrink-0 flex-col border-t bg-background shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.35)]'>
    <div role='separator' aria-orientation='horizontal' aria-label={t('records.table.resize')} title={t('records.table.resizeHint')} tabIndex={0}
      onPointerDown={startResize} onKeyDown={resizeWithKeys} onDoubleClick={() => { resizeTo(DEFAULT_HEIGHT); remember(); }}
      className='group absolute inset-x-0 -top-2 z-10 flex h-4 cursor-row-resize items-center justify-center focus-visible:outline-none'>
      <span className='h-1.5 w-16 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary' />
    </div>

    <header className='flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5'>
      <Table2 className='h-3.5 w-3.5 shrink-0 text-primary' />
      <h2 className='text-xs font-semibold'>{t('records.table.title', { name: concept?.label ?? '' })}</h2>
      {data && <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground'>
        {narrowed ? t('records.table.matches', { count: total }) : t('records.table.count', { count: total })}
      </span>}
      {/* Where this concept's records come from, one chip per source. */}
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>
        {mappings.map((mapping) => {
          const Icon = mapping.scope === 'workspace' ? FolderOpen : mapping.assetKind === 'document' ? FileText : Sheet;
          return <button key={mapping.id} type='button' onClick={() => onOpenSource?.(mapping)} disabled={!onOpenSource}
            title={t('records.table.openSource', { name: mapping.documentName ?? '' })}
            className='flex max-w-[14rem] items-center gap-1 rounded-full border border-teal-500/40 bg-teal-500/5 px-2 py-0.5 text-[11px] text-teal-800 hover:bg-teal-500/10 disabled:cursor-default dark:text-teal-300'>
            <Icon className='h-3 w-3 shrink-0' />
            <span className='truncate'>{mapping.documentName}</span>
            {mapping.scope === 'workspace' && <span className='shrink-0 text-teal-700/70 dark:text-teal-300/70'>· {t('records.table.files', { count: mapping.fileCount ?? 0 })}</span>}
          </button>;
        })}
        {typedCount > 0 && <span className='flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground'>
          <Table2 className='h-3 w-3' />{t('records.table.typedSource', { count: typedCount })}
        </span>}
        {madeFrom.map((name) => <span key={name} className='flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/5 px-2 py-0.5 text-[11px] text-violet-800 dark:text-violet-300'>
          <GitBranch className='h-3 w-3' />{t('records.table.madeFrom', { name })}
        </span>)}
        {!mappings.length && !typedCount && !madeFrom.length && <span className='text-[11px] text-muted-foreground'>{t('records.table.noSource')}</span>}
      </div>
      {filtering && <Button variant='ghost' size='sm' className='h-7 px-2 text-xs' onClick={() => setFilters({})}>
        <FilterX className='me-1 h-3.5 w-3.5' />{t('records.table.clearFilters')}
      </Button>}
      <div className='relative w-52 max-w-full'>
        <Search className='pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground' />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('records.table.search')} aria-label={t('records.table.search')}
          className='h-7 ps-7 text-xs' />
        {records.isFetching && <Loader2 className='absolute right-2 top-1.5 h-3.5 w-3.5 animate-spin text-muted-foreground' />}
      </div>
      {onRefresh && <Button variant='outline' size='sm' className='h-7 px-2 text-xs' onClick={onRefresh} disabled={refreshing || (!mappings.length && !typedCount && !madeFrom.length)}
        title={t('records.table.refreshHint')}>
        <RefreshCw className={cn('me-1 h-3.5 w-3.5', refreshing && 'animate-spin')} />
        {refreshing ? t('records.table.refreshing') : t('records.table.refresh')}
      </Button>}
      <Button variant='ghost' size='icon' className='h-7 w-7' onClick={onClose} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>
    </header>

    <div className='min-h-0 flex-1 overflow-auto pb-16 pe-16'>
      {records.isError ? <p role='alert' className='p-6 text-center text-xs text-destructive'>{t('records.table.error', { message: parseApiError(records.error).message })}</p>
        : records.isLoading ? <div className='flex justify-center p-8'><Loader2 className='h-5 w-5 animate-spin text-primary' /></div>
        : !data?.dataRevisionId ? <p className='p-6 text-center text-xs text-muted-foreground'>{t('records.table.noData')}</p>
        : <table className='table-fixed border-separate border-spacing-0 text-xs' style={{ width: tableWidth }}>
          <colgroup>{headers.map((header) => <col key={header.key} style={{ width: widthOf(header.key) }} />)}</colgroup>
          <thead className='sticky top-0 z-[1] bg-background text-start text-[11px] text-muted-foreground'>
            <tr>
              {headers.map((header) => <th key={header.key} className='relative border-b px-2 py-1 font-medium'>
                <span className='block truncate' title={header.label}>{header.label}</span>
                <span role='separator' aria-orientation='vertical' aria-label={t('records.table.resizeColumn', { name: header.label })} tabIndex={0}
                  title={t('records.table.resizeHint')}
                  onPointerDown={(event) => startColumnResize(header.key, event)} onKeyDown={(event) => resizeColumnWithKeys(header.key, event)}
                  onDoubleClick={() => { setColumnWidth(header.key, null); rememberWidths(); }}
                  className='absolute inset-y-0 -right-1 z-[2] w-2 cursor-col-resize after:absolute after:inset-y-1 after:left-1/2 after:w-px after:bg-border hover:after:bg-primary focus-visible:outline-none focus-visible:after:bg-primary' />
              </th>)}
            </tr>
            <tr>
              {headers.map((header) => <th key={header.key} className='border-b px-1 py-1 font-normal'>
                {header.filterable && <Input value={filters[header.key] ?? ''} placeholder={t('records.table.filterPlaceholder')}
                  aria-label={t('records.table.filter', { name: header.label })}
                  onChange={(event) => setFilters((current) => ({ ...current, [header.key]: event.target.value }))}
                  className='h-6 rounded-sm px-1.5 text-[11px]' />}
              </th>)}
            </tr>
          </thead>
          <tbody>
            {!data.records.length && <tr><td colSpan={headers.length} className='p-6 text-center text-muted-foreground'>
              {narrowed ? t('records.table.noMatch', { query: [query, ...Object.values(appliedFilters)].filter(Boolean).join(' · ') }) : t('records.table.empty', { name: concept?.label ?? '' })}
            </td></tr>}
            {data.records.map((record) => {
              const sources = [...new Set(Object.values(record.provenance)
                .map((origin) => origin.source.kind === 'manual' ? t('records.table.typed') : origin.source.documentName)
                .filter(Boolean))];
              return <tr key={record.id} className='hover:bg-muted/40'>
                <td className='truncate border-b px-2 py-1 font-medium' title={record.label}>{record.label}</td>
                {columns.map((column) => {
                  const own = display(record.values[column.key]);
                  // A key field is kept as the matching key, in its normalized form.
                  const key = own ? '' : display(record.identity?.[column.key]);
                  const value = own || key;
                  const origin = record.provenance[column.key];
                  const long = own.length > LONG_VALUE;
                  const tip = long ? `${own.slice(0, LONG_VALUE)}…\n${t('records.table.readFull', { chars: own.length.toLocaleString() })}` : own;
                  return <td key={column.key} title={own ? [tip, originText(origin, t, concepts)].filter(Boolean).join('\n') : key ? t('records.table.keyValue') : t('records.table.missing')}
                    className={cn('truncate border-b px-2 py-1', origin?.correction && 'text-primary', key && 'font-mono text-[11px] text-amber-800 dark:text-amber-300')}>
                    {long
                      ? <button type='button' className='block w-full truncate text-start hover:underline'
                        onClick={() => setReading({ record: record.label, field: column.label || column.key, text: own })}>
                        <FileText className='me-1 inline h-3 w-3 align-[-2px] text-muted-foreground' />{own.slice(0, LONG_VALUE)}
                      </button>
                      : value || <span className='text-muted-foreground/60'>—</span>}
                  </td>;
                })}
                <td className='truncate border-b px-2 py-1 text-[11px] text-muted-foreground' title={sources.join(', ')}>{sources.join(', ')}</td>
              </tr>;
            })}
          </tbody>
        </table>}
    </div>

    {total > PAGE_SIZE && <footer className='flex items-center justify-end gap-2 border-t py-1 ps-4 pe-20 text-[11px] text-muted-foreground'>
      <span className='tabular-nums'>{t('records.table.range', { from: from.toLocaleString(), to: to.toLocaleString(), total: total.toLocaleString() })}</span>
      <Button variant='ghost' size='icon' className='h-6 w-6' disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} aria-label={t('records.table.previous')}><ChevronLeft className='h-4 w-4' /></Button>
      <Button variant='ghost' size='icon' className='h-6 w-6' disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)} aria-label={t('records.table.next')}><ChevronRight className='h-4 w-4' /></Button>
    </footer>}

    <Dialog open={reading !== null} onOpenChange={(open) => { if (!open) setReading(null); }}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='truncate'>{reading?.field}</DialogTitle>
          <DialogDescription className='truncate'>{reading?.record} · {t('records.table.characters', { chars: (reading?.text.length ?? 0).toLocaleString() })}</DialogDescription>
        </DialogHeader>
        <pre className='max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-sans text-xs'>{reading?.text}</pre>
      </DialogContent>
    </Dialog>
  </section>;
}
