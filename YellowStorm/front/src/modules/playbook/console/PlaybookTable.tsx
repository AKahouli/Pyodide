import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM } from '../utils/playbookVM';
import { successRate } from '../utils/playbookVM';
import type { SortDir, SortKey } from './consoleState';
import { RelativeTime, ReliabilityStrip, StatusPill, TriggerCell, formatDurationMs } from './atoms';
import { RowActions } from './RowActions';
import type { PlaybookActions } from './types';

interface Props {
  vms: PlaybookVM[];
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  actions: PlaybookActions;
  showReliability: boolean;
}

const TH_BASE = 'px-2.5 py-2 text-left text-[10.5px] font-medium uppercase tracking-[0.07em] text-muted-foreground';
const TD_BASE = 'px-2.5 py-[9px] align-middle';

export function PlaybookTable({ vms, sort, dir, onSort, selected, onToggleSelect, actions, showReliability }: Props) {
  const { t } = useModuleTranslation('playbook');
  const anySelected = selected.size > 0;

  const sortableHeader = (key: SortKey, label: string) => {
    const active = sort === key;
    return (
      <th scope="col" className={`${TH_BASE} ${key === 'steps' ? 'w-[60px]' : ''}`} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`inline-flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-ring ${
            active ? 'text-foreground' : 'hover:text-foreground'
          }`}
        >
          {label}
          {active && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] border-collapse text-[13px] leading-[1.45]">
        <thead>
          <tr className="border-b">
            <th scope="col" className={`${TH_BASE} w-[30px]`} aria-label={t('console.selectRow')} />
            <th scope="col" className={`${TH_BASE} w-[26px]`} aria-label={t('card.favorite')} />
            {sortableHeader('name', t('console.col.playbook'))}
            {sortableHeader('state', t('console.col.state'))}
            {showReliability && sortableHeader('reliability', t('console.col.reliability'))}
            {sortableHeader('steps', t('console.col.steps'))}
            <th scope="col" className={TH_BASE}>{t('console.col.trigger')}</th>
            {sortableHeader('lastRun', t('console.col.lastRun'))}
            <th scope="col" className={TH_BASE}>{t('console.col.next')}</th>
            <th scope="col" className={`${TH_BASE} w-[96px]`} aria-label={t('console.col.actions')} />
          </tr>
        </thead>
        <tbody>
          {vms.map((vm) => {
            const isSelected = selected.has(vm.id);
            const rate = successRate(vm);
            const stepExtra = vm.state === 'running' && vm.live && vm.stepCount ? `${vm.live.currentStepIndex}/${vm.stepCount}` : undefined;
            return (
              <tr
                key={vm.id}
                tabIndex={0}
                data-selected={isSelected}
                aria-selected={isSelected}
                onClick={() => actions.onOpen(vm)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter') { e.preventDefault(); actions.onOpen(vm); }
                  else if (e.key === ' ') { e.preventDefault(); onToggleSelect(vm.id); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus(); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }
                }}
                className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <td className={TD_BASE}>
                  <span className={`inline-flex ${isSelected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                    <Checkbox
                      aria-label={t('console.selectRowName', { name: vm.name })}
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelect(vm.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                  </span>
                </td>
                <td className={TD_BASE}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); actions.onToggleFavorite(vm); }}
                    aria-label={t(vm.isFavorite ? 'card.unfavorite' : 'card.favorite')}
                    aria-pressed={vm.isFavorite}
                    className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${vm.isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/70 hover:text-foreground'}`}
                      aria-hidden
                    />
                  </button>
                </td>
                <td className={`${TD_BASE} min-w-[260px]`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium" title={vm.name}>{vm.name}</span>
                      {vm.duplicateOfId && (
                        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground" title={t('console.badge.copy.title')}>
                          {t('console.badge.copy')}
                        </span>
                      )}
                      {vm.isEmptyDraft && (
                        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                          {t('console.badge.emptyDraft')}
                        </span>
                      )}
                    </div>
                    {vm.purpose && <p className="mt-0.5 truncate text-xs text-muted-foreground">{vm.purpose}</p>}
                    {vm.labels.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {vm.labels.map((label) => (
                          <span key={label} className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </td>
                <td className={TD_BASE}>
                  <StatusPill state={vm.state} extra={stepExtra} />
                </td>
                {showReliability && (
                  <td className={TD_BASE}>
                    {vm.history === null ? null : vm.history.length === 0 ? (
                      <span className="text-xs italic text-muted-foreground">{t('console.neverRun')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <ReliabilityStrip history={vm.history} />
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{rate}%</span>
                      </span>
                    )}
                  </td>
                )}
                <td className={`${TD_BASE} font-mono tabular-nums`}>{vm.stepCount ?? '—'}</td>
                <td className={TD_BASE}>
                  <TriggerCell trigger={vm.trigger} playbookName={vm.name} onOpenTriggers={() => actions.onOpenTriggers(vm)} />
                </td>
                <td className={TD_BASE}>
                  {vm.lastRun ? (
                    <span className="inline-flex flex-col">
                      <RelativeTime iso={vm.lastRun.startedAt} className="text-xs" />
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatDurationMs(vm.lastRun.durationMs)}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className={TD_BASE}>
                  <RelativeTime iso={vm.trigger.nextRunAt} className="text-xs text-muted-foreground" />
                </td>
                <td className={`${TD_BASE} opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100`}>
                  <RowActions vm={vm} actions={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
