import { AlertCircle, Check, Link2, Loader2, Minus, Play, Sparkles, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM } from '../utils/playbookVM';
import { successRate } from '../utils/playbookVM';
import { RelativeTime, StatusPill, formatDurationMs } from './atoms';
import { RowActions } from './RowActions';
import type { PlaybookActions } from './types';

const STEP_ICONS: Record<string, typeof Check> = {
  completed: Check,
  running: Loader2,
  pending_approval: AlertCircle,
  queued: AlertCircle,
  pending: AlertCircle,
  interrupted: AlertCircle,
  failed: AlertCircle,
  skipped: Minus,
  cancelled: Minus,
};

const STEP_CLASSES: Record<string, string> = {
  completed: 'text-ok',
  running: 'text-run animate-spin motion-reduce:animate-none',
  pending_approval: 'text-wait',
  queued: 'text-wait',
  pending: 'text-wait',
  interrupted: 'text-fail',
  failed: 'text-fail',
  skipped: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
};

export function PlaybookDrawer({
  vm,
  actions,
  onOpenRun,
  onClose,
}: {
  vm: PlaybookVM | null;
  actions: PlaybookActions;
  onOpenRun: (vmId: string, runId: string) => void;
  onClose: () => void;
}) {
  const { t } = useModuleTranslation('playbook');
  if (!vm) return null;
  const rate = successRate(vm);

  return (
    <Sheet open={vm !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full min-w-0 flex-col gap-0 overflow-y-auto p-0 sm:max-w-[430px]" data-testid="playbook-drawer">
        <SheetHeader className="space-y-1 border-b p-4">
          <SheetTitle className="text-base leading-tight">{vm.name}</SheetTitle>
          {vm.purpose ? (
            <SheetDescription asChild>
              <p className="text-xs leading-relaxed">
                {vm.purpose}
                {vm.purposeIsDerived && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                    <Sparkles className="h-2.5 w-2.5" aria-hidden />
                    {t('console.drawer.autoPurpose')}
                  </span>
                )}
              </p>
            </SheetDescription>
          ) : null}
          {vm.purposeIsDerived && (
            <Button variant="ghost" size="sm" className="h-6 w-fit px-2 text-[11px] text-muted-foreground" onClick={() => actions.onEditDetails(vm)}>
              {t('console.drawer.editDescription')}
            </Button>
          )}
        </SheetHeader>

        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">{t('console.col.state')}</dt>
            <dd><StatusPill state={vm.state} /></dd>
            <dt className="text-muted-foreground">{t('console.col.reliability')}</dt>
            <dd className="font-mono tabular-nums">{rate === null ? '—' : `${rate}%`}</dd>
            <dt className="text-muted-foreground">{t('console.col.steps')}</dt>
            <dd className="font-mono tabular-nums">{vm.stepCount ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('console.col.trigger')}</dt>
            <dd>{vm.trigger.kind === 'manual' || !vm.trigger.label ? t(`console.trigger.${vm.trigger.kind}`) : vm.trigger.label}</dd>
            {vm.trigger.nextRunAt && (
              <>
                <dt className="text-muted-foreground">{t('console.col.next')}</dt>
                <dd><RelativeTime iso={vm.trigger.nextRunAt} /></dd>
              </>
            )}
            {vm.labels.length > 0 && (
              <>
                <dt className="text-muted-foreground">{t('console.drawer.labels')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {vm.labels.map((label) => (
                    <span key={label} className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{label}</span>
                  ))}
                </dd>
              </>
            )}
          </dl>

          {vm.failure?.message && (
            <div>
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('console.drawer.lastError')}</h3>
              <p className="border-l-2 border-fail pl-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{vm.failure.message}</p>
            </div>
          )}

          {vm.nodes.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('console.drawer.steps')}</h3>
              <ol className="space-y-1">
                {vm.nodes.map((node, index) => {
                  const status = vm.live?.stepStatuses[node.id];
                  const Icon = status ? STEP_ICONS[status] ?? Minus : Minus;
                  return (
                    <li key={node.id} className="flex items-center gap-2 text-xs">
                      <Icon className={`h-3 w-3 shrink-0 ${status ? STEP_CLASSES[status] ?? 'text-muted-foreground' : 'text-muted-foreground/40'}`} aria-hidden />
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 truncate">{node.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {vm.recentRuns.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('console.drawer.recentRuns')}</h3>
              <ul className="space-y-1">
                {vm.recentRuns.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      onClick={() => onOpenRun(vm.id, run.id)}
                      className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="flex items-center gap-2">
                        <span className={`h-[5px] w-[5px] rounded-full ${run.outcome === 'succeeded' ? 'bg-ok' : run.outcome === 'failed' ? 'bg-fail' : run.outcome === 'cancelled' ? 'bg-idle' : 'bg-run'}`} aria-hidden />
                        <span className="font-mono tabular-nums">#{run.executionNumber}</span>
                        <span className="text-muted-foreground">{t(`outcome.${run.outcome}`)}</span>
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono text-[10px] tabular-nums">{formatDurationMs(run.durationMs)}</span>
                        <RelativeTime iso={run.startedAt} className="text-[10px]" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {vm.integrationToken && (
            <div>
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('console.drawer.integration')}</h3>
              <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <Link2 className="h-3 w-3" aria-hidden />
                {vm.integrationToken}
              </p>
            </div>
          )}
        </div>

        <Separator />
        <div className="sticky bottom-0 flex items-center gap-2 bg-background/95 p-3 backdrop-blur">
          <Button size="sm" onClick={() => actions.onRun(vm)}>
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('console.drawer.runNow')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => actions.onEditCanvas(vm)}>
            <Workflow className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('console.drawer.openCanvas')}
          </Button>
          <span className="flex-1" />
          <RowActions vm={vm} actions={actions} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
