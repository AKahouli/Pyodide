import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Loader2, Search, SlidersHorizontal, X, ArrowUpDown, CheckSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { usePlaybookStore, usePlaybooks, usePlaybooksLoading } from '../store';
import type { PaginationMeta, PlaybookQueryParams } from '../types';
import { PlaybookCard } from './PlaybookCard';
import { CreatePlaybookDialog } from './CreatePlaybookDialog';
import { PlaybookBetaDisclaimer } from './PlaybookBetaDisclaimer';
import { useModuleTranslation } from '@/modules/localization';

const DEBOUNCE_MS = 200;

type SortByOption = NonNullable<PlaybookQueryParams['sortBy']>;
type SortOrderOption = NonNullable<PlaybookQueryParams['sortOrder']>;
type DateFieldOption = NonNullable<PlaybookQueryParams['dateField']>;

const SORT_OPTIONS: SortByOption[] = ['updatedAt', 'createdAt', 'name', 'taskCount', 'lastExecutionAt'];
const DATE_FIELD_OPTIONS: DateFieldOption[] = ['createdAt', 'updatedAt', 'lastExecutionAt'];

function hasActiveFilters(q: PlaybookQueryParams): boolean {
  return !!(
    q.search ||
    q.minTasks !== undefined ||
    q.maxTasks !== undefined ||
    q.dateField ||
    q.dateFrom ||
    q.dateTo ||
    (q.sortBy && q.sortBy !== 'updatedAt') ||
    (q.sortOrder && q.sortOrder !== 'desc')
  );
}

export function PlaybookListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const playbooks = usePlaybooks();
  const loading = usePlaybooksLoading();
  const fetchPlaybooks = usePlaybookStore((s) => s.fetchPlaybooks);
  const fetchMorePlaybooks = usePlaybookStore((s) => s.fetchMorePlaybooks);
  const deletePlaybook = usePlaybookStore((s) => s.deletePlaybook);
  const clonePlaybook = usePlaybookStore((s) => s.clonePlaybook);
  const toggleFavorite = usePlaybookStore((s) => s.toggleFavorite);
  const bulkDeletePlaybooks = usePlaybookStore((s) => s.bulkDeletePlaybooks);
  const pagination = usePlaybookStore((s) => s.playbooksPagination) as PaginationMeta | null;
  const currentQuery = usePlaybookStore((s) => s.playbooksQuery);
  const generateRetryData = usePlaybookStore((s) => s.generateRetryData);
  const clearGenerateRetry = usePlaybookStore((s) => s.clearGenerateRetry);
  const hasMore = pagination ? pagination.page < pagination.totalPages : false;

  // Auto-open dialog on generation failure to let user retry
  useEffect(() => {
    if (generateRetryData) {
      setCreateOpen(true);
    }
  }, [generateRetryData]);

  const handleCreateOpenChange = useCallback((open: boolean) => {
    setCreateOpen(open);
    if (!open && generateRetryData) {
      clearGenerateRetry();
    }
  }, [generateRetryData, clearGenerateRetry]);
  const { t } = useModuleTranslation('playbook');

  // Local search input state (debounced before sending to API)
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFetchDone = useRef(false);

  // Filter state
  const [sortBy, setSortBy] = useState<SortByOption>('updatedAt');
  const [sortOrder, setSortOrder] = useState<SortOrderOption>('desc');
  const [minTasks, setMinTasks] = useState('');
  const [maxTasks, setMaxTasks] = useState('');
  const [dateField, setDateField] = useState<DateFieldOption | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Build query from current UI state
  const buildQuery = useCallback(
    (searchOverride?: string): PlaybookQueryParams => {
      const q: PlaybookQueryParams = {
        sortBy,
        sortOrder,
      };
      const search = searchOverride ?? searchInput;
      if (search.trim()) q.search = search.trim();
      if (minTasks !== '' && !isNaN(parseInt(minTasks, 10))) q.minTasks = parseInt(minTasks, 10);
      if (maxTasks !== '' && !isNaN(parseInt(maxTasks, 10))) q.maxTasks = parseInt(maxTasks, 10);
      if (dateField) q.dateField = dateField;
      if (dateFrom) q.dateFrom = new Date(dateFrom).toISOString();
      if (dateTo) {
        // Set end of day for dateTo
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        q.dateTo = end.toISOString();
      }
      return q;
    },
    [searchInput, sortBy, sortOrder, minTasks, maxTasks, dateField, dateFrom, dateTo],
  );

  // Trigger fetch with current filters
  const applyFilters = useCallback(() => {
    fetchPlaybooks(buildQuery());
  }, [fetchPlaybooks, buildQuery]);

  // Initial fetch
  useEffect(() => {
    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchPlaybooks({});
    }
  }, [fetchPlaybooks]);

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchPlaybooks(buildQuery(value));
      }, DEBOUNCE_MS);
    },
    [fetchPlaybooks, buildQuery],
  );

  // Search on Enter (immediate)
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        fetchPlaybooks(buildQuery());
      }
    },
    [fetchPlaybooks, buildQuery],
  );

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchPlaybooks(buildQuery(''));
  }, [fetchPlaybooks, buildQuery]);

  // Apply filters from popover
  const handleApplyFilters = useCallback(() => {
    setFiltersOpen(false);
    applyFilters();
  }, [applyFilters]);

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setSearchInput('');
    setSortBy('updatedAt');
    setSortOrder('desc');
    setMinTasks('');
    setMaxTasks('');
    setDateField('');
    setDateFrom('');
    setDateTo('');
    setFiltersOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchPlaybooks({});
  }, [fetchPlaybooks]);

  // Toggle sort order
  const handleToggleSortOrder = useCallback(() => {
    const next = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(next);
    fetchPlaybooks({ ...buildQuery(), sortOrder: next });
  }, [sortOrder, fetchPlaybooks, buildQuery]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deletePlaybook(id);
    },
    [deletePlaybook],
  );

  const handleClone = useCallback(
    async (id: string) => {
      await clonePlaybook(id);
    },
    [clonePlaybook],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => { toggleFavorite(id); },
    [toggleFavorite],
  );

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await bulkDeletePlaybooks(Array.from(selectedIds));
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [selectedIds, bulkDeletePlaybooks]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isFiltered = hasActiveFilters(currentQuery);
  const showNoResults = !loading && playbooks.length === 0 && isFiltered;
  const showEmpty = !loading && playbooks.length === 0 && !isFiltered;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">{t('list.title')}</h1>
        <div className="flex items-center gap-2">
          {playbooks.length > 0 && (
            <Button variant={selectMode ? 'secondary' : 'ghost'} size="sm" onClick={handleToggleSelectMode}>
              <CheckSquare className="h-4 w-4 mr-1.5" />
              {t(selectMode ? 'list.cancelSelect' : 'list.select')}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('list.newPlaybook')}
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/50">
          <span className="text-sm text-muted-foreground">
            {t('list.selected', { count: selectedIds.size })}
          </span>
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {t('list.deleteSelected')}
          </Button>
        </div>
      )}

      {/* Search + Filters bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b">
        {/* Search input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('list.searchPlaceholder')}
            className="pl-9 pr-8"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Sort by selector */}
        <Select
          value={sortBy}
          onValueChange={(v) => {
            const nextSort = v as SortByOption;
            setSortBy(nextSort);
            // Build query with the new sortBy directly (state update is async)
            const q = buildQuery();
            q.sortBy = nextSort;
            fetchPlaybooks(q);
          }}
        >
          <SelectTrigger className="w-[170px]">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`list.sort.${opt}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort order toggle */}
        <Button variant="outline" size="icon" onClick={handleToggleSortOrder} title={t(`list.order.${sortOrder}`)}>
          <ArrowUpDown className={`h-4 w-4 transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
        </Button>

        {/* Filters popover */}
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant={isFiltered ? 'secondary' : 'outline'} size="sm" className="gap-1.5">
              <SlidersHorizontal className="h-4 w-4" />
              {t('list.filters')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              {/* Task count range */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">{t('list.sort.taskCount')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    placeholder={t('list.minTasks')}
                    value={minTasks}
                    onChange={(e) => setMinTasks(e.target.value)}
                    className="h-8"
                  />
                  <span className="text-muted-foreground">-</span>
                  <Input
                    type="number"
                    min={0}
                    placeholder={t('list.maxTasks')}
                    value={maxTasks}
                    onChange={(e) => setMaxTasks(e.target.value)}
                    className="h-8"
                  />
                </div>
              </div>

              {/* Date filter */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">{t('list.dateField')}</Label>
                <Select value={dateField || 'none'} onValueChange={(v) => setDateField(v === 'none' ? '' : v as DateFieldOption)}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder={t('list.dateField')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">&mdash;</SelectItem>
                    {DATE_FIELD_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {t(`list.dateField.${opt}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dateField && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">{t('list.dateFrom')}</Label>
                      <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">{t('list.dateTo')}</Label>
                      <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t">
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  {t('list.clearFilters')}
                </Button>
                <Button size="sm" onClick={handleApplyFilters}>
                  {t('list.filters')}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Clear filters indicator */}
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters} className="text-muted-foreground gap-1">
            <X className="h-3.5 w-3.5" />
            {t('list.clearFilters')}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && playbooks.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-muted-foreground mb-4">
              {t('list.empty')}
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('list.newPlaybook')}
            </Button>
          </div>
        ) : showNoResults ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-muted-foreground mb-4">
              {t('list.noResults')}
            </p>
            <Button variant="outline" onClick={handleClearFilters}>
              {t('list.clearFilters')}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {playbooks.map((playbook) => (
              <PlaybookCard
                key={playbook.id}
                playbook={playbook}
                onDelete={handleDelete}
                onClone={handleClone}
                onToggleFavorite={handleToggleFavorite}
                selectable={selectMode}
                selected={selectedIds.has(playbook.id)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-6">
                <Button variant="outline" onClick={fetchMorePlaybooks} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {t('list.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <CreatePlaybookDialog open={createOpen} onOpenChange={handleCreateOpenChange} retryData={generateRetryData} />
      <PlaybookBetaDisclaimer />
    </div>
  );
}
