import { useEffect, useMemo, useState } from 'react';
import { useSearch } from '@embedpdf/plugin-search/react';
import { ChevronDown, ChevronUp, Loader2, Search as SearchIcon, X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';

type SearchControlsProps = Readonly<{ documentId: string }>;

export function SearchControls({ documentId }: SearchControlsProps) {
  const { state, provides: search } = useSearch(documentId);
  const [query, setQuery] = useState('');
  const { t } = useModuleTranslation('file-viewer');

  useEffect(() => {
    setQuery(state.query ?? '');
  }, [state.query]);

  const trimmedQuery = query.trim();
  const hasMatches = state.total > 0;
  const summaryLabel = useMemo(() => {
    if (state.loading) return t('search.summary.searching');
    if (hasMatches) {
      const current = Math.max(1, state.activeResultIndex + 1);
      const total = state.total ?? 0;
      return t('search.summary.results', { current, total });
    }
    return t('search.summary.none');
  }, [hasMatches, state.activeResultIndex, state.loading, state.total, t]);

  const canSearch = Boolean(search && trimmedQuery.length > 0);
  const disableNavigation = !search || !hasMatches || state.loading;
  const disableClear = !search || (!state.active && trimmedQuery.length === 0 && !state.loading);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!search) return;

    if (!trimmedQuery) {
      search.stopSearch();
      return;
    }

    search.startSearch();
    search.searchAllPages(trimmedQuery);
  };

  const handleClear = () => {
    if (!search) return;
    setQuery('');
    search.stopSearch();
  };

  const handlePrevious = () => {
    if (disableNavigation) return;
    search?.previousResult();
  };

  const handleNext = () => {
    if (disableNavigation) return;
    search?.nextResult();
  };

  const actionButtonClass = 'inline-flex h-8 items-center justify-center rounded-md bg-background text-foreground shadow-sm ring-1 ring-border transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
  const navButtonClass = `${actionButtonClass} w-8`;

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-3 py-2 text-xs'>
      <form onSubmit={handleSubmit} className='flex flex-1 flex-wrap items-center gap-2'>
        <div className='relative flex-1 min-w-55'>
          <SearchIcon className='pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <input type='text' value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder')} className='h-8 w-full rounded border border-border bg-background pl-8 pr-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' />
        </div>

        <button type='submit' disabled={!canSearch || state.loading} className={`${actionButtonClass} px-3 text-xs font-medium gap-1`}>
          {state.loading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : t('search.submit')}
        </button>

        <button type='button' onClick={handleClear} disabled={disableClear} className={`${actionButtonClass} px-3 text-xs font-medium gap-1`}>
          <X className='h-3.5 w-3.5' />
          {t('search.clear')}
        </button>
      </form>

      <div className='flex items-center gap-2 text-[11px] uppercase tracking-wide'>
        <span className='text-muted-foreground'>{summaryLabel}</span>
        <button type='button' onClick={handlePrevious} disabled={disableNavigation} className={navButtonClass} title={t('tooltip.previousMatch')}>
          <ChevronUp className='h-4 w-4' />
        </button>
        <button type='button' onClick={handleNext} disabled={disableNavigation} className={navButtonClass} title={t('tooltip.nextMatch')}>
          <ChevronDown className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
}
