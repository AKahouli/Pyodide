import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, FolderOpen, Keyboard, Loader2, Search, Sheet, Table2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useSourceMappings } from '../../query/hooks';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptRecordsPage, ConceptSourceMapping } from '../../types';

const PAGE_SIZE = 50;
const HEIGHT_KEY = 'semantic-model.records-panel-height';
const MIN_HEIGHT = 180;
const DEFAULT_HEIGHT = 320;

type RecordRow = ConceptRecordsPage['records'][number];
type ValueOrigin = RecordRow['provenance'][string];

function storedHeight() {
  try { const saved = Number(window.localStorage.getItem(HEIGHT_KEY)); return saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT; } catch { return DEFAULT_HEIGHT; }
}

/** Where one value came from, in words: "customers.xlsx · Sheet1 · row 4", or who fixed it. */
function originText(origin: ValueOrigin | undefined, t: (key: 'records.table.row' | 'records.table.page' | 'records.table.typed' | 'records.table.fixedBy', options?: Record<string, string | number | boolean | null | undefined>) => string) {
  if (!origin) return '';
  if (origin.correction) return t('records.table.fixedBy', { name: origin.correction.correctedBy || '—' });
  if (origin.source.kind === 'manual') return t('records.table.typed');
  const parts = [origin.source.documentName, origin.source.sheetName].filter(Boolean) as string[];
  if (origin.rowNumber !== undefined) parts.push(t('records.table.row', { row: origin.rowNumber }));
  else if (origin.field?.page) parts.push(t('records.table.page', { page: origin.field.page }));
  return parts.join(' · ');
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The records a concept holds in the data in use, as a table under the canvas: every field, searchable, a
 * page at a time, with where each value came from. Its top edge drags to make it taller.
 */
export function ConceptRecordsPanel({ modelId, conceptId, onClose, onOpenSource }: Readonly<{
  modelId: string;
  conceptId: string;
  onClose: () => void;
  onOpenSource?: (mapping: ConceptSourceMapping) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const concept = useSemanticModelEditorStore((state) => state.graph?.nodes.find((node) => node.id === conceptId));
  const typedCount = useSemanticModelEditorStore((state) => state.graph?.records.filter((record) => record.nodeTypeId === conceptId).length ?? 0);
  const mappings = (useSourceMappings(modelId).data ?? []).filter((mapping) => mapping.conceptId === conceptId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [height, setHeight] = useState(storedHeight);
  const heightRef = useRef(height);

  useEffect(() => { setSearch(''); setQuery(''); setPage(0); }, [conceptId]);
  // Search as the person types, without a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const records = useQuery({
    queryKey: ['semantic-models', 'concept-records', modelId, conceptId, query, page],
    queryFn: () => semanticModelApi.conceptRecords(modelId, conceptId, { q: query || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = records.data;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const columns = useMemo(() => concept?.attributes ?? [], [concept?.attributes]);

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

  const from = total ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return <section aria-label={t('records.table.title', { name: concept?.label ?? '' })} style={{ height }}
    className='relative flex shrink-0 flex-col border-t bg-background shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.35)]'>
    <div role='separator' aria-orientation='horizontal' aria-label={t('records.table.resize')} title={t('records.table.resizeHint')} tabIndex={0}
      onPointerDown={startResize} onKeyDown={resizeWithKeys} onDoubleClick={() => { resizeTo(DEFAULT_HEIGHT); remember(); }}
      className='group absolute inset-x-0 -top-2 z-10 flex h-4 cursor-row-resize items-center justify-center focus-visible:outline-none'>
      <span className='h-1.5 w-16 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary' />
    </div>

    <header className='flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5'>
      <Table2 className='h-4 w-4 shrink-0 text-primary' />
      <h2 className='text-sm font-semibold'>{t('records.table.title', { name: concept?.label ?? '' })}</h2>
      {data && <span className='rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground'>
        {query ? t('records.table.matches', { count: total }) : t('records.table.count', { count: total })}
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
          <Keyboard className='h-3 w-3' />{t('records.table.typedSource', { count: typedCount })}
        </span>}
        {!mappings.length && !typedCount && <span className='text-[11px] text-muted-foreground'>{t('records.table.noSource')}</span>}
      </div>
      <div className='relative w-56 max-w-full'>
        <Search className='pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground' />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('records.table.search')} aria-label={t('records.table.search')}
          className='h-8 pl-8 text-sm' />
        {records.isFetching && <Loader2 className='absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground' />}
      </div>
      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={onClose} aria-label={t('action.close')}><X className='h-4 w-4' /></Button>
    </header>

    <div className='min-h-0 flex-1 overflow-auto pb-16 pr-16'>
      {records.isError ? <p role='alert' className='p-6 text-center text-sm text-destructive'>{t('records.table.error', { message: parseApiError(records.error).message })}</p>
        : records.isLoading ? <div className='flex justify-center p-8'><Loader2 className='h-5 w-5 animate-spin text-primary' /></div>
        : !data?.dataRevisionId ? <p className='p-6 text-center text-sm text-muted-foreground'>{t('records.table.noData')}</p>
        : !data.records.length ? <p className='p-6 text-center text-sm text-muted-foreground'>{query ? t('records.table.noMatch', { query }) : t('records.table.empty', { name: concept?.label ?? '' })}</p>
        : <table className='w-full min-w-max border-separate border-spacing-0 text-sm'>
          <thead className='sticky top-0 z-[1] bg-background text-left text-xs text-muted-foreground'>
            <tr>
              <th className='border-b px-3 py-2 font-medium'>{t('records.table.name')}</th>
              {columns.map((column) => <th key={column.key} className='border-b px-3 py-2 font-medium'>{column.label || column.key}</th>)}
              <th className='border-b px-3 py-2 font-medium'>{t('records.table.source')}</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((record) => {
              const sources = [...new Set(Object.values(record.provenance)
                .map((origin) => origin.source.kind === 'manual' ? t('records.table.typed') : origin.source.documentName)
                .filter(Boolean))];
              return <tr key={record.id} className='hover:bg-muted/40'>
                <td className='max-w-[16rem] truncate border-b px-3 py-1.5 font-medium' title={record.label}>{record.label}</td>
                {columns.map((column) => {
                  const own = display(record.values[column.key]);
                  // A key field is kept as the matching key, in its normalized form.
                  const key = own ? '' : display(record.identity?.[column.key]);
                  const value = own || key;
                  const origin = record.provenance[column.key];
                  return <td key={column.key} title={own ? [own, originText(origin, t)].filter(Boolean).join('\n') : key ? t('records.table.keyValue') : t('records.table.missing')}
                    className={cn('max-w-[18rem] truncate border-b px-3 py-1.5', origin?.correction && 'text-primary', key && 'font-mono text-xs text-amber-800 dark:text-amber-300')}>
                    {value || <span className='text-muted-foreground/60'>—</span>}
                  </td>;
                })}
                <td className='max-w-[16rem] truncate border-b px-3 py-1.5 text-xs text-muted-foreground' title={sources.join(', ')}>{sources.join(', ')}</td>
              </tr>;
            })}
          </tbody>
        </table>}
    </div>

    {total > PAGE_SIZE && <footer className='flex items-center justify-end gap-2 border-t py-1.5 pl-4 pr-20 text-xs text-muted-foreground'>
      <span className='tabular-nums'>{t('records.table.range', { from: from.toLocaleString(), to: to.toLocaleString(), total: total.toLocaleString() })}</span>
      <Button variant='ghost' size='icon' className='h-7 w-7' disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} aria-label={t('records.table.previous')}><ChevronLeft className='h-4 w-4' /></Button>
      <Button variant='ghost' size='icon' className='h-7 w-7' disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)} aria-label={t('records.table.next')}><ChevronRight className='h-4 w-4' /></Button>
    </footer>}
  </section>;
}
