import { useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownUp, Plus, Search } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useDeleteStream, useStreams } from '../../query/hooks';
import { NewStreamDialog } from '../NewStreamDialog';
import { StreamCard } from '../StreamCard';
import { ShareStreamDialog } from '../ShareStreamDialog';
import {
  STREAM_STATUS_GROUPS,
  sumStatusCounts,
  type StreamStatusGroup,
} from '../../streamStats';
import type { WorkyStreamQueryParams, WorkyStreamSortField } from '../../types';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;
const FILTER_GROUPS: StreamStatusGroup[] = ['active', 'attention', 'paused', 'completed', 'archived'];
const SORT_FIELDS: WorkyStreamSortField[] = ['lastActivity', 'created', 'title'];

/**
 * Worky landing page: find, filter, page through and create streams. Each card
 * carries live per-stream task stats; KPIs and filter-chip counts come from the
 * paginated envelope's `meta.statusCounts`, so they stay accurate across pages.
 */
export function StreamsDashboard(): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [group, setGroup] = useState<StreamStatusGroup | null>(null);
  const [sort, setSort] = useState<WorkyStreamSortField>('lastActivity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);

  // Debounce the free-text search and reset to page 1 when it settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const params: WorkyStreamQueryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      page,
      limit: PAGE_SIZE,
      status: group && group !== 'attention' ? STREAM_STATUS_GROUPS[group] : undefined,
      attention: group === 'attention' ? true : undefined,
      sort,
      sortDir,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
    }),
    [debouncedSearch, page, group, sort, sortDir, createdFrom, createdTo],
  );

  const { data: envelope, isLoading } = useStreams(params);
  const deleteStream = useDeleteStream();

  const streams = envelope?.data ?? [];
  const statusCounts = envelope?.meta.statusCounts ?? {};
  const attentionCount = envelope?.meta.attentionCount ?? 0;
  const totalPages = envelope?.meta.totalPages ?? 0;


  const selectGroup = (next: StreamStatusGroup | null): void => {
    setGroup(next);
    setPage(1);
  };

  const onDelete = async (stream: { id: string; title: string }): Promise<void> => {
    const confirmed = window.confirm(t('dashboard.deleteConfirm', { title: stream.title }));
    if (!confirmed) return;
    try {
      await deleteStream.mutateAsync(stream.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('dashboard.deleteFailed'));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="worky-stream-search"
              name="streamSearch"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              className="h-9 pl-8"
            />
          </div>
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-testid="worky-new-stream"
            className="shrink-0"
          >
            <Plus className="mr-1 size-4" />
            {t('dashboard.newStream')}
          </Button>
        </div>
      </div>

      <p className='text-sm text-muted-foreground'>{t('command.portfolio.summary')}</p>

      {/* Filter + sort toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="chip-all"
            onClick={() => selectGroup(null)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              group === null
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/40',
            )}
          >
            {t('dashboard.filters.all')}
          </button>
          {FILTER_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              data-testid={`chip-${g}`}
              onClick={() => selectGroup(g)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                group === g
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              {t(`dashboard.filters.${g}`)} {envelope ? `(${g === 'attention' ? attentionCount : sumStatusCounts(statusCounts, STREAM_STATUS_GROUPS[g])})` : ''}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={t('dashboard.filters.createdFrom')}
            data-testid="filter-created-from"
            value={createdFrom}
            onChange={(e) => {
              setCreatedFrom(e.target.value);
              setPage(1);
            }}
            className="h-9 w-[9.5rem]"
          />
          <Input
            type="date"
            aria-label={t('dashboard.filters.createdTo')}
            data-testid="filter-created-to"
            value={createdTo}
            onChange={(e) => {
              setCreatedTo(e.target.value);
              setPage(1);
            }}
            className="h-9 w-[9.5rem]"
          />
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as WorkyStreamSortField);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-[10rem]" data-testid="sort-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_FIELDS.map((field) => (
                <SelectItem key={field} value={field}>
                  {t(`dashboard.sort.${field}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            aria-label={t('dashboard.sort.toggleDirection')}
            data-testid="sort-direction"
            onClick={() => {
              setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
          >
            <ArrowDownUp className="size-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : streams.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('dashboard.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {streams.map((s) => (
            <StreamCard
              key={s.id}
              stream={s}
              onOpen={() => navigate(`/worky/${s.id}`)}
              onDelete={() => void onDelete(s)}
              onShare={() => setSharing({ id: s.id, title: s.title })}
              isDeleting={deleteStream.isPending}
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between pt-2">
          <p data-testid="pagination-summary" className="text-xs text-muted-foreground">
            {t('dashboard.pagination.summary', { page, totalPages })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="pagination-prev"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('dashboard.pagination.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="pagination-next"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('dashboard.pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <NewStreamDialog open={createOpen} onOpenChange={setCreateOpen} />
      {sharing ? (
        <ShareStreamDialog
          streamId={sharing.id}
          title={sharing.title}
          open
          onOpenChange={(open) => { if (!open) setSharing(null); }}
        />
      ) : null}
    </div>
  );
}
