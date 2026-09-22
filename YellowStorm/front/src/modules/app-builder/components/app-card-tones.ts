import { cn } from '@/lib/utils';

/** Catalog card accents — semantic tokens only (theme-safe). */
export type AppCardTone = 'live' | 'shared' | 'draft' | 'error' | 'busy';

const TONE_SURFACE: Record<AppCardTone, string> = {
  live: 'border-ok/20 bg-gradient-to-br from-ok-soft/40 via-card to-card hover:border-ok/35',
  shared: 'border-run/20 bg-gradient-to-br from-run-soft/40 via-card to-card hover:border-run/35',
  draft: 'border-idle/25 bg-gradient-to-br from-idle-soft/50 via-card to-card hover:border-idle/40',
  error: 'border-fail/25 bg-gradient-to-br from-fail-soft/40 via-card to-card hover:border-fail/40',
  busy: 'border-run/20 bg-gradient-to-br from-run-soft/35 via-card to-card hover:border-run/35',
};

const TONE_ICON: Record<AppCardTone, string> = {
  live: 'bg-ok-soft text-ok',
  shared: 'bg-run-soft text-run',
  draft: 'bg-idle-soft text-idle',
  error: 'bg-fail-soft text-fail',
  busy: 'bg-run-soft text-run',
};

const TONE_BADGE: Record<AppCardTone, string> = {
  live: 'border-ok/25 bg-ok-soft/60 text-ok',
  shared: 'border-run/25 bg-run-soft/60 text-run',
  draft: 'border-idle/30 bg-idle-soft/70 text-idle',
  error: 'border-fail/30 bg-fail-soft/70 text-fail',
  busy: 'border-run/25 bg-run-soft/60 text-run',
};

const TONE_LIST: Record<AppCardTone, string> = {
  live: 'border-ok/15 hover:border-ok/30',
  shared: 'border-run/15 hover:border-run/30',
  draft: 'border-idle/20 hover:border-idle/35',
  error: 'border-fail/20 hover:border-fail/35',
  busy: 'border-run/15 hover:border-run/30',
};

export function appCardSurfaceClass(tone: AppCardTone, view: 'grid' | 'list'): string {
  if (view === 'list') {
    return cn(
      'group relative flex items-center gap-4 rounded-xl border bg-card px-4 py-3.5',
      'transition-[border-color,background-color,box-shadow] duration-200',
      'hover:bg-accent/25 hover:shadow-sm',
      TONE_LIST[tone],
    );
  }
  return cn(
    'group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card',
    'transition-[border-color,box-shadow,transform] duration-200',
    'hover:-translate-y-0.5 hover:shadow-md',
    'focus-within:ring-2 focus-within:ring-ring/40',
    TONE_SURFACE[tone],
  );
}

export function appCardIconClass(tone: AppCardTone): string {
  return cn(
    'flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/40',
    TONE_ICON[tone],
  );
}

export function appCardBadgeClass(tone: AppCardTone): string {
  return cn(
    'shrink-0 gap-1 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
    TONE_BADGE[tone],
  );
}

export function extractAppHost(url: string): string | null {
  try {
    const host = new URL(url).host;
    return host || null;
  } catch {
    return null;
  }
}
