import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileText, Loader2, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DocumentPreviewViewer, type DocumentPreviewNavigation } from '@/modules/file-viewer/components/DocumentPreviewViewer';
import { useModuleTranslation } from '@/modules/localization';
import type { DocumentFieldReading, StructuredSourceAsset } from '../../types';
import { INPUT_COMPACT } from '../form/FormParts';
import { pageRange } from './DocumentFieldRules';

// A long passage is found in the viewer by its first words.
const HIGHLIGHT_CHARACTERS = 120;
const SPLIT_STORAGE_KEY = 'semantic-model.document-split';
export const NARROW_QUERY = '(max-width: 1023px)';
export const DEFAULT_SPLIT = { document: 55, fields: 45 };

/** The first ~120 characters of a quote, cut at a word, which the viewer's search can find. */
export function highlightOf(quote?: string | null) {
  const text = quote?.replaceAll(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= HIGHLIGHT_CHARACTERS) return text;
  const cut = text.slice(0, HIGHLIGHT_CHARACTERS);
  const space = cut.lastIndexOf(' ');
  return space > HIGHLIGHT_CHARACTERS / 2 ? cut.slice(0, space) : cut;
}

type SplitPrefs = { collapsed: boolean; layout: { document: number; fields: number } };

function readSplitPrefs(): SplitPrefs {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SPLIT_STORAGE_KEY) ?? 'null') as Partial<SplitPrefs> | null;
    const layout = saved?.layout;
    return {
      collapsed: saved?.collapsed === true,
      layout: layout && Number.isFinite(layout.document) && Number.isFinite(layout.fields) ? layout : DEFAULT_SPLIT,
    };
  } catch {
    return { collapsed: false, layout: DEFAULT_SPLIT };
  }
}

/** Whether the document is shown and how the two panes share the drawer, kept between visits. */
export function useSplitPrefs() {
  const [prefs, setPrefs] = useState(readSplitPrefs);
  const save = useCallback((patch: Partial<SplitPrefs>) => setPrefs((current) => {
    const next = { ...current, ...patch };
    try { globalThis.localStorage?.setItem(SPLIT_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be blocked */ }
    return next;
  }), []);
  return [prefs, save] as const;
}

/** True below 1024 px, where the document and the fields are tabs instead of side by side. */
export function useNarrow() {
  const query = () => typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(NARROW_QUERY) : null;
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media?.addEventListener) return;
    const listener = (event: MediaQueryListEvent) => setNarrow(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return narrow;
}

/**
 * The document beside the fields: a switcher over the source's documents and the file viewer,
 * scrolled and highlighted on request.
 */
export function DocumentPreviewPane({ documents, shown, onShow, navigation, onPageCount }: Readonly<{
  documents: StructuredSourceAsset[];
  shown?: StructuredSourceAsset;
  onShow: (documentId: string) => void;
  navigation: DocumentPreviewNavigation | null;
  onPageCount?: (documentId: string, count: number) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const index = shown ? documents.findIndex((asset) => asset.documentId === shown.documentId) : -1;
  const go = (step: number) => {
    const next = documents[index + step];
    if (next) onShow(next.documentId);
  };
  // Arrows switch documents while focus is in the header, except inside the list itself.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[role="combobox"], [role="listbox"], input')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
  };

  return <section className='flex h-full min-h-0 flex-col bg-muted/20' aria-label={t('mapping.live.documentPane')}>
    <div className='flex min-h-12 items-center gap-1.5 border-b bg-background px-3 py-2' role='toolbar' aria-label={t('mapping.live.switcher')} onKeyDown={onKeyDown}>
      <Button type='button' size='icon' variant='ghost' className='h-7 w-7 shrink-0' disabled={index <= 0} aria-label={t('mapping.live.previous')} onClick={() => go(-1)}><ChevronLeft className='h-4 w-4' /></Button>
      {documents.length > 1 && shown ? <Select value={shown.documentId} onValueChange={onShow}>
        <SelectTrigger className={cn(INPUT_COMPACT, 'min-w-0 flex-1 text-xs')} aria-label={t('mapping.live.chooseDocument')}>
          <FileText className='mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground' /><span className='truncate'><SelectValue /></span>
        </SelectTrigger>
        <SelectContent>{documents.map((asset) => <SelectItem key={asset.documentId} value={asset.documentId} className='text-xs'>{asset.name}</SelectItem>)}</SelectContent>
      </Select> : <span className='flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium'><FileText className='h-3.5 w-3.5 shrink-0 text-muted-foreground' /><span className='truncate'>{shown?.name}</span></span>}
      <Button type='button' size='icon' variant='ghost' className='h-7 w-7 shrink-0' disabled={index < 0 || index >= documents.length - 1} aria-label={t('mapping.live.next')} onClick={() => go(1)}><ChevronRight className='h-4 w-4' /></Button>
      {documents.length > 0 && index >= 0 && <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground' aria-live='polite'>{t('mapping.live.position', { index: index + 1, total: documents.length })}</span>}
    </div>
    <div className='relative min-h-0 flex-1'>
      {shown
        ? <DocumentPreviewViewer key={shown.documentId} workspaceId={shown.workspaceId} documentId={shown.documentId} fileName={shown.name} mimeType={shown.mimeType} navigation={navigation}
          onPageCount={onPageCount ? (count) => onPageCount(shown.documentId, count) : undefined} />
        : <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground'>
          <FileText className='h-6 w-6' />{t('mapping.live.noDocument')}
        </div>}
    </div>
  </section>;
}

/** Plain words for why a document could not be read, e.g. not indexed yet. */
const KNOWN_STATUSES = ['index_unavailable', 'not_indexed', 'indexing', 'failed', 'empty', 'not_found'] as const;
type KnownStatus = typeof KNOWN_STATUSES[number];

export function documentStatusText(t: (key: `mapping.live.status.${KnownStatus | 'unknown'}`, params?: { status: string }) => string, status: string) {
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? t(`mapping.live.status.${status as KnownStatus}`) : t('mapping.live.status.unknown', { status });
}

/**
 * What the shown document gives for one field: found (with the value and its page), or why not,
 * with a way to see it in the document.
 */
export function FieldLiveStatus({ reading: current, pending, stale, labels, onShow, onFindLabel }: Readonly<{
  reading?: DocumentFieldReading;
  /** The document is being read again for this field. */
  pending: boolean;
  /** Read with rules that have changed since; shown dimmed until read again. */
  stale: boolean;
  labels: string[];
  onShow: (reading: DocumentFieldReading) => void;
  onFindLabel: (label: string) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  if (!current) {
    return pending ? <div className='flex h-7 items-center gap-1.5 rounded-md bg-muted/40 px-2 text-[11px] text-muted-foreground' role='status'>
      <Loader2 className='h-3 w-3 animate-spin' />{t('mapping.live.reading')}
    </div> : null;
  }
  const found = current.reason === 'found';
  const several = current.reason === 'several_values';
  const value = found ? String(current.value ?? '') : '';
  const Icon = found ? CheckCircle2 : several ? AlertTriangle : XCircle;
  const canShow = found && Boolean(current.page || current.quote);
  return <div className={cn('flex min-h-7 items-start gap-1.5 rounded-md px-2 py-1 text-[11px] transition-opacity',
    found ? 'bg-emerald-500/5' : several ? 'bg-amber-500/10' : 'bg-muted/50', stale && 'opacity-60')}>
    {pending ? <Loader2 className='mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground' aria-label={t('mapping.live.reading')} />
      : <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', found ? 'text-emerald-600 dark:text-emerald-400' : several ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}
        aria-label={found ? t('mapping.reading.reason.found') : t('mapping.live.notFound')} />}
    <div className='min-w-0 flex-1'>
      {found ? <button type='button' disabled={!canShow} className='block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:underline'
        aria-label={t('mapping.live.showValue', { value: value.slice(0, 80) })} onClick={() => onShow(current)}>
        <span className='line-clamp-2 break-words'>{value}</span>
      </button>
        : <p className='text-foreground/80'>{t(`mapping.reading.reason.${current.reason}`, { values: (current.values ?? []).map((item) => `“${item}”`).join(', '), detail: current.detail ?? '' })}</p>}
    </div>
    {found && current.page ? <span className='shrink-0 tabular-nums text-muted-foreground'>{pageRange(t, current.page, current.pageEnd)}</span> : null}
    {canShow && <Button type='button' size='sm' variant='ghost' className='h-5 shrink-0 px-1.5 text-[11px]' onClick={() => onShow(current)}>{t('mapping.live.show')}</Button>}
    {!found && labels.length > 0 && <Button type='button' size='sm' variant='ghost' className='h-5 shrink-0 px-1.5 text-[11px]' onClick={() => onFindLabel(labels[0])}>
      <Search className='mr-1 h-3 w-3' />{t('mapping.live.findLabel')}
    </Button>}
  </div>;
}
