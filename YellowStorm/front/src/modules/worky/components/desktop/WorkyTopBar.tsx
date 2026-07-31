import type { JSX } from 'react';
import { Zap, Search, Wallet, Bell, ChevronDown, User } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useStream, useStreamBudget } from '../../query/hooks';

/**
 * Desktop Worky top bar (matches the Pencil design): logo + wordmark, a stream
 * switcher, a search field, the live budget chip, and profile controls.
 */
export function WorkyTopBar({ streamId }: { streamId: string }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { data: stream } = useStream(streamId);
  const { data: budget } = useStreamBudget(streamId);
  const budgetLabel =
    budget != null ? `$${(budget.spendUsd ?? 0).toFixed(2)} / $${budget.limitUsd ?? 0}` : null;

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="size-4" />
        </span>
        <span className="text-base font-bold text-foreground">Worky</span>
        <span className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5">
          <span className="size-2 shrink-0 rounded-full bg-worky-working" />
          <span className="max-w-[220px] truncate text-sm font-semibold text-foreground">
            {stream?.title ?? ''}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex w-56 items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm text-muted-foreground">{t('sidebar.searchPlaceholder')}</span>
        </div>
        {budgetLabel ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
            <Wallet className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-semibold text-foreground">{budgetLabel}</span>
          </div>
        ) : null}
        <button
          type="button"
          aria-label={t('nav.worky')}
          className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
        >
          <Bell className="size-4" />
        </button>
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
          <User className="size-4" />
        </span>
      </div>
    </div>
  );
}
