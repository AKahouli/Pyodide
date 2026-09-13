import { Clock, Mail, Play } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization/types';
import type { PlaybookState, PlaybookVM, RunOutcome, TriggerKind } from '../utils/playbookVM';

/** Static class maps so Tailwind can see every variant (§9.2). */
const PILL_CLASSES: Record<PlaybookState, string> = {
  running: 'bg-run-soft text-run border-run/30',
  queued: 'bg-run-soft text-run border-run/30',
  pending: 'bg-run-soft text-run border-run/30',
  awaiting_approval: 'bg-wait-soft text-wait border-wait/30',
  interrupted: 'bg-fail-soft text-fail border-fail/30',
  failed: 'bg-fail-soft text-fail border-fail/30',
  completed: 'bg-ok-soft text-ok border-ok/30',
  cancelled: 'bg-idle-soft text-idle border-idle/30',
  idle: 'bg-idle-soft text-idle border-idle/30',
};

export const STATE_LABEL_KEY: Record<PlaybookState, ModuleTranslationKey<'playbook'>> = {
  running: 'status.running',
  queued: 'status.queued',
  pending: 'status.pending',
  awaiting_approval: 'status.pending_approval',
  interrupted: 'status.interrupted',
  failed: 'status.failed',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
  idle: 'status.idle',
};

export function StatusPill({ state, extra }: { state: PlaybookState; extra?: string }) {
  const { t } = useModuleTranslation('playbook');
  return (
    <span
      className={`inline-flex h-[21px] max-w-full items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium ${PILL_CLASSES[state]}`}
    >
      <span
        className={`h-[5px] w-[5px] shrink-0 rounded-full bg-current ${state === 'running' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        aria-hidden
      />
      <span className="truncate">{t(STATE_LABEL_KEY[state])}{extra ? ` ${extra}` : ''}</span>
    </span>
  );
}

const BAR_CLASSES: Record<RunOutcome, string> = {
  succeeded: 'h-4 bg-ok',
  failed: 'h-[70%] bg-fail',
  cancelled: 'h-[45%] bg-muted-foreground/50',
  running: 'h-4 bg-run/55',
};

export function ReliabilityStrip({ history }: { history: RunOutcome[] }) {
  const { t } = useModuleTranslation('playbook');
  const succeeded = history.filter((o) => o === 'succeeded').length;
  return (
    <span
      className="inline-flex h-4 items-end gap-[2px]"
      aria-label={t('console.reliability.aria', { succeeded, total: history.length })}
    >
      {history.map((outcome, i) => (
        <span key={i} title={t(`outcome.${outcome}`)} className={`w-1 rounded-[1px] ${BAR_CLASSES[outcome]}`} />
      ))}
    </span>
  );
}

const TRIGGER_ICONS: Record<TriggerKind, typeof Play> = {
  manual: Play,
  schedule: Clock,
  mail: Mail,
};

export function TriggerCell({
  trigger,
  onOpenTriggers,
  playbookName,
}: {
  trigger: PlaybookVM['trigger'];
  onOpenTriggers?: () => void;
  playbookName: string;
}) {
  const { t } = useModuleTranslation('playbook');
  const Icon = TRIGGER_ICONS[trigger.kind] ?? Play;
  const label = trigger.kind === 'manual' || !trigger.label
    ? t(`console.trigger.${trigger.kind}` as ModuleTranslationKey<'playbook'>)
    : trigger.label;
  if (!onOpenTriggers) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenTriggers();
      }}
      className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${t('console.trigger.open')}: ${playbookName}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

export function RelativeTime({ iso, className }: { iso: string | null; className?: string }) {
  const { language } = useModuleTranslation('playbook');
  if (!iso) return <span className={className}>—</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>;
  const formatted = new Intl.DateTimeFormat(language, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return (
    <time dateTime={iso} title={date.toLocaleString(language)} className={`font-mono tabular-nums ${className ?? ''}`}>
      {formatted}
    </time>
  );
}

/** Compact elapsed duration, e.g. "4m 12s". */
export function formatElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) return '—';
  return formatElapsed(ms);
}
