import { useModuleTranslation } from '@/modules/localization';
import { Loader2 } from 'lucide-react';

type Tone = 'status' | 'control';

export function StatusBadge({
  status,
  tone = 'status',
}: {
  status: string;
  tone?: Tone;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const key = tone === 'control' ? `badges.control.${status}` : `badges.status.${status}`;
  const isRunning = status === 'running';
  // `t` is typed against the namespace's key set; dynamic keys built from
  // the canonical enum unions are valid by construction but the TS
  // template-literal narrows the union incorrectly. Cast to satisfy the
  // strict type while keeping runtime calls in the canonical set.
  const label = t(key as Parameters<typeof t>[0]);
  return (
    <span
      className='inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground/80'
      aria-label={label}
    >
      {isRunning ? <Loader2 className='h-3 w-3 animate-spin' aria-hidden /> : null}
      {label}
    </span>
  );
}
