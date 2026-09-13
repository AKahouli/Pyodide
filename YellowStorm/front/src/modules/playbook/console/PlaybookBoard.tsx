import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM, PlaybookState } from '../utils/playbookVM';
import { RelativeTime, ReliabilityStrip, StatusPill } from './atoms';
import type { PlaybookActions } from './types';

/** Board grouped by operational state. No drag and drop — state is not user-assignable. */
export function PlaybookBoard({ vms, actions }: { vms: PlaybookVM[]; actions: PlaybookActions }) {
  const { t } = useModuleTranslation('playbook');
  const columns: Array<{ id: string; title: string; states: PlaybookState[] }> = [
    { id: 'inflight', title: t('console.rail.inflight'), states: ['running', 'queued', 'pending'] },
    { id: 'waiting', title: t('console.rail.waiting'), states: ['awaiting_approval'] },
    { id: 'fix', title: t('console.board.needsFix'), states: ['failed', 'interrupted'] },
    { id: 'clean', title: t('console.board.finishedClean'), states: ['completed'] },
    { id: 'idle', title: t('console.board.notRunning'), states: ['idle', 'cancelled'] },
  ];
  return (
    <div className="flex gap-3 overflow-x-auto p-4 sm:px-6">
      {columns.map((column) => {
        const items = vms.filter((vm) => column.states.includes(vm.state));
        return (
          <section key={column.id} className="flex w-[240px] shrink-0 flex-col gap-2" aria-label={column.title}>
            <header className="flex items-center justify-between px-1">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{column.title}</h3>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {items.map((vm) => (
                <button
                  key={vm.id}
                  type="button"
                  onClick={() => actions.onOpen(vm)}
                  className="rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium" title={vm.name}>{vm.name}</span>
                    <StatusPill state={vm.state} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {vm.stepCount === null ? '—' : t('console.stepsCount', { count: vm.stepCount })}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <RelativeTime iso={vm.lastRun?.startedAt ?? null} className="text-[11px]" />
                      {vm.history && vm.history.length > 0 && <ReliabilityStrip history={vm.history} />}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
