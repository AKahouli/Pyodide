import { useEffect, useState } from 'react';
import { LayoutGrid, Rows, Search, SlidersHorizontal, SquareKanban, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookState } from '../utils/playbookVM';
import type { ConsoleState, ConsoleView } from './consoleState';
import { STATE_LABEL_KEY } from './atoms';

const CHIP_DOT: Record<PlaybookState, string> = {
  running: 'bg-run', queued: 'bg-run', pending: 'bg-run',
  awaiting_approval: 'bg-wait', failed: 'bg-fail', interrupted: 'bg-fail',
  completed: 'bg-ok', cancelled: 'bg-idle', idle: 'bg-idle',
};

const DEBOUNCE_MS = 150;

export function FilterBar({
  state,
  onChange,
  statesPresent,
  segmentCounts,
}: {
  state: ConsoleState;
  onChange: (patch: Partial<ConsoleState>) => void;
  /** States present in the current segment, with counts — only non-zero render. */
  statesPresent: Array<{ state: PlaybookState; count: number }>;
  segmentCounts: { matched: number; total: number };
}) {
  const { t } = useModuleTranslation('playbook');
  const [search, setSearch] = useState(state.q);

  useEffect(() => setSearch(state.q), [state.q]);

  // Debounced commit of the search input into URL state.
  useEffect(() => {
    if (search === state.q) return;
    const timer = setTimeout(() => onChange({ q: search }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, state.q, onChange]);

  const filtersActive =
    state.minSteps !== undefined || state.maxSteps !== undefined || state.from !== undefined || state.to !== undefined;
  const views: Array<{ id: ConsoleView; icon: typeof Rows; label: string }> = [
    { id: 'table', icon: Rows, label: t('console.view.table') },
    { id: 'board', icon: SquareKanban, label: t('console.view.board') },
    { id: 'cards', icon: LayoutGrid, label: t('console.view.cards') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('console.search.placeholder')}
          aria-label={t('console.search.placeholder')}
          data-testid="playbook-search"
          className="h-8 pl-9 pr-8"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label={t('list.clearSearch')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('console.statusFilter')}>
        {statesPresent
          .filter(({ count }) => count > 0)
          .map(({ state: s, count }) => {
            const active = state.states.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({ states: active ? state.states.filter((x) => x !== s) : [...state.states, s] })
                }
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  active ? 'border-primary/50 bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`h-[5px] w-[5px] rounded-full ${CHIP_DOT[s]}`} aria-hidden />
                {t(STATE_LABEL_KEY[s])}
                <span className="font-mono text-[11px] tabular-nums">{count}</span>
              </button>
            );
          })}
        {state.states.length > 0 && (
          <button
            type="button"
            onClick={() => onChange({ states: [] })}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
            {t('console.chipClear')}
          </button>
        )}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant={filtersActive ? 'secondary' : 'outline'} size="sm" className="h-8 gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            {t('list.filters')}
          </Button>
        </PopoverTrigger>
        <FiltersPopoverContent state={state} onChange={onChange} />
      </Popover>

      <span className="min-w-8 flex-1" />

      {segmentCounts.total > 0 && (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground" data-testid="match-count">
          {segmentCounts.matched}/{segmentCounts.total}
        </span>
      )}

      <div className="flex items-center rounded-md border p-0.5" role="group" aria-label={t('console.view.label')}>
        {views.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={state.view === id}
            aria-label={label}
            title={label}
            onClick={() => onChange({ view: id })}
            className={`inline-flex h-7 w-8 items-center justify-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
              state.view === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

function FiltersPopoverContent({
  state,
  onChange,
}: {
  state: ConsoleState;
  onChange: (patch: Partial<ConsoleState>) => void;
}) {
  const { t } = useModuleTranslation('playbook');
  const [minSteps, setMinSteps] = useState(state.minSteps?.toString() ?? '');
  const [maxSteps, setMaxSteps] = useState(state.maxSteps?.toString() ?? '');
  const [dateField, setDateField] = useState<ConsoleState['dateField']>(state.dateField);
  const [from, setFrom] = useState(state.from ?? '');
  const [to, setTo] = useState(state.to ?? '');

  useEffect(() => {
    setMinSteps(state.minSteps?.toString() ?? '');
    setMaxSteps(state.maxSteps?.toString() ?? '');
    setDateField(state.dateField);
    setFrom(state.from ?? '');
    setTo(state.to ?? '');
  }, [state.minSteps, state.maxSteps, state.dateField, state.from, state.to]);

  const apply = () =>
    onChange({
      minSteps: minSteps === '' ? undefined : parseInt(minSteps, 10),
      maxSteps: maxSteps === '' ? undefined : parseInt(maxSteps, 10),
      dateField,
      from: from || undefined,
      to: to || undefined,
    });

  return (
    <PopoverContent className="w-80" align="start">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">{t('console.filters.steps')}</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} placeholder={t('list.minTasks')} value={minSteps} onChange={(e) => setMinSteps(e.target.value)} className="h-8" />
            <span className="text-muted-foreground">-</span>
            <Input type="number" min={0} placeholder={t('list.maxTasks')} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} className="h-8" />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">{t('list.dateField')}</Label>
          <Select value={dateField} onValueChange={(v) => setDateField(v as ConsoleState['dateField'])}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">{t('list.dateField.createdAt')}</SelectItem>
              <SelectItem value="updatedAt">{t('list.dateField.updatedAt')}</SelectItem>
              <SelectItem value="lastExecutionAt">{t('list.dateField.lastExecutionAt')}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label={t('list.dateFrom')} value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" />
            <Input type="date" aria-label={t('list.dateTo')} value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMinSteps('');
              setMaxSteps('');
              setFrom('');
              setTo('');
              onChange({ minSteps: undefined, maxSteps: undefined, from: undefined, to: undefined });
            }}
          >
            {t('list.clearFilters')}
          </Button>
          <Button size="sm" onClick={apply}>
            {t('console.filters.apply')}
          </Button>
        </div>
      </div>
    </PopoverContent>
  );
}
