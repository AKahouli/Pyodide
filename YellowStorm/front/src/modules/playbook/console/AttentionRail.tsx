import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Eye, RefreshCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookState, PlaybookVM } from '../utils/playbookVM';
import type { SegmentId } from './consoleState';
import { formatElapsed } from './atoms';

const MAX_ITEMS = 5;

/** Rail action set — the page owns the real mutations. */
export interface RailActions {
  onWatchRun: (vm: PlaybookVM) => void;
  onStop: (vm: PlaybookVM) => void;
  onApprove: (vm: PlaybookVM) => void;
  onRetry: (vm: PlaybookVM) => void;
  onMore: (segment: SegmentId, states: PlaybookState[]) => void;
}

export function AttentionRail({ vms, actions }: { vms: PlaybookVM[]; actions: RailActions }) {
  const { t } = useModuleTranslation('playbook');

  const inFlight = vms.filter((p) => ['running', 'queued', 'pending'].includes(p.state));
  const waiting = vms.filter((p) => p.state === 'awaiting_approval');
  const cutoff = Date.now() - 48 * 3600_000;
  const broke = vms.filter(
    (p) => ['failed', 'interrupted'].includes(p.state) && (!p.lastRun || new Date(p.lastRun.startedAt).getTime() >= cutoff),
  );
  const ticking = inFlight.length > 0 || waiting.length > 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(288px,1fr))] gap-3 px-4 pt-4 sm:px-6" data-testid="attention-rail">
      {/* In flight */}
      <section className="rounded-lg border bg-card p-3" aria-label={t('console.rail.inflight')} data-testid="rail-inflight">
        <header className="mb-2 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-run" aria-hidden />
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('console.rail.inflight')}</h2>
        </header>
        {inFlight.length === 0 ? (
          <RailEmpty label={t('console.rail.inflight.empty')} />
        ) : (
          <ul className="space-y-2.5">
            {inFlight.slice(0, MAX_ITEMS).map((vm) => (
              <li key={vm.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => actions.onWatchRun(vm)}
                    className="min-w-0 truncate text-left text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {vm.name}
                  </button>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground" data-testid="elapsed">
                    {vm.live ? formatElapsed(now - new Date(vm.live.startedAt).getTime()) : ''}
                  </span>
                </div>
                {vm.live && (
                  <>
                    {vm.state === 'queued' ? (
                      <p className="text-[11px] text-muted-foreground">
                        {vm.live.queuePosition != null ? t('console.rail.queue', { position: vm.live.queuePosition }) : t('status.queued')}
                      </p>
                    ) : (
                      <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={vm.live.progressPct ?? undefined}>
                        {vm.live.progressPct == null ? (
                          <div className="h-full w-full bg-run/50 motion-reduce:animate-none" />
                        ) : (
                          <div className="h-full rounded-full bg-run transition-[width] motion-reduce:transition-none" style={{ width: `${vm.live.progressPct}%` }} />
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                        {vm.live.currentStepName ? `${vm.live.currentStepIndex} · ${vm.live.currentStepName}` : ''}
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => actions.onWatchRun(vm)}>
                          <Eye className="mr-1 h-3 w-3" aria-hidden />
                          {t('console.rail.watch')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
                          onClick={() => actions.onStop(vm)}
                        >
                          <Square className="mr-1 h-3 w-3" aria-hidden />
                          {t('console.rail.stop')}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </li>
            ))}
            <RailMore count={inFlight.length - MAX_ITEMS} onClick={() => actions.onMore('live', [])} />
          </ul>
        )}
      </section>

      {/* Waiting on you */}
      <section className="rounded-lg border bg-card p-3" aria-label={t('console.rail.waiting')} data-testid="rail-waiting">
        <header className="mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-wait" aria-hidden />
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('console.rail.waiting')}</h2>
        </header>
        {waiting.length === 0 ? (
          <RailEmpty label={t('console.rail.waiting.empty')} />
        ) : (
          <ul className="space-y-2.5">
            {waiting.slice(0, MAX_ITEMS).map((vm) => (
              <li key={vm.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => actions.onWatchRun(vm)}
                    className="min-w-0 truncate text-left text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {vm.name}
                  </button>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {vm.approval ? t('console.rail.blockedFor', { duration: formatElapsed(now - new Date(vm.approval.blockedSince).getTime()) }) : ''}
                  </span>
                </div>
                {vm.approval && (
                  <>
                    <p className="text-[11px] font-medium text-wait">{vm.approval.nodeName}</p>
                    {vm.approval.summary && <p className="line-clamp-2 text-[11px] text-muted-foreground">{vm.approval.summary}</p>}
                  </>
                )}
                <div className="flex items-center gap-1">
                  <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => actions.onApprove(vm)}>
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                    {t('console.rail.approve')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => actions.onWatchRun(vm)}>
                    {t('console.rail.review')}
                  </Button>
                </div>
              </li>
            ))}
            <RailMore count={waiting.length - MAX_ITEMS} onClick={() => actions.onMore('live', ['awaiting_approval'])} />
          </ul>
        )}
      </section>

      {/* Broke since yesterday */}
      <section className="rounded-lg border bg-card p-3" aria-label={t('console.rail.broke')} data-testid="rail-broke">
        <header className="mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-fail" aria-hidden />
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('console.rail.broke')}</h2>
        </header>
        {broke.length === 0 ? (
          <RailEmpty label={t('console.rail.broke.empty')} />
        ) : (
          <ul className="space-y-2.5">
            {broke.slice(0, MAX_ITEMS).map((vm) => (
              <li key={vm.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => actions.onWatchRun(vm)}
                    className="min-w-0 truncate text-left text-[13px] font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {vm.name}
                  </button>
                </div>
                {vm.failure?.message && (
                  <p className="line-clamp-2 border-l-2 border-fail pl-2 text-[11px] text-muted-foreground" data-testid="rail-error">
                    {vm.failure.message}
                  </p>
                )}
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => actions.onRetry(vm)}>
                    <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                    {t('console.rail.retry')}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => actions.onWatchRun(vm)}>
                    {t('console.rail.openTrace')}
                  </Button>
                </div>
              </li>
            ))}
            <RailMore count={broke.length - MAX_ITEMS} onClick={() => actions.onMore('live', ['failed', 'interrupted'])} />
          </ul>
        )}
      </section>
    </div>
  );
}

function RailEmpty({ label }: { label: string }) {
  return <p className="flex min-h-8 items-center text-[11px] italic text-muted-foreground/70">{label}</p>;
}

function RailMore({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useModuleTranslation('playbook');
  if (count <= 0) return null;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t('console.rail.more', { count })}
      </button>
    </li>
  );
}
