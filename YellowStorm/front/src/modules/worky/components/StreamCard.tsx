import type { JSX } from 'react';
import { Clock, Loader2, Trash2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { WorkyStreamListItem } from '../types';
import { formatElapsedMinutes } from '../streamStats';
import { StatusBadge } from './StatusBadge';

interface StreamCardProps {
  stream: WorkyStreamListItem;
  onOpen: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

/**
 * A single stream tile on the home page: status, elapsed active time, live task
 * rollup, progress meter and (when a budget is set) a slim spend line.
 */
export function StreamCard({ stream, onOpen, onDelete, isDeleting }: StreamCardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { stats, budget } = stream;
  const progressPct = Math.round((stats.progress || 0) * 100);
  const hasBudget = budget.limitUsd > 0;
  const budgetPct = hasBudget ? Math.min(100, Math.round((budget.spendUsd / budget.limitUsd) * 100)) : 0;

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
      <button
        type="button"
        data-testid="stream-card-open"
        onClick={onOpen}
        className="flex flex-col gap-3 text-left"
      >
        <div className="flex items-center justify-between gap-2 pr-8">
          <StatusBadge status={stream.status} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {formatElapsedMinutes(stream.activeDurationMinutes)}
          </span>
        </div>

        <span className="truncate text-base font-semibold text-foreground">{stream.title}</span>

        <div data-testid="stream-card-tasks" className="text-xs text-muted-foreground">
          {stats.totalTasks === 0 ? (
            t('dashboard.card.noTasks')
          ) : (
            <>
              {t('dashboard.card.tasks', { n: stats.totalTasks })}
              {' · '}
              {t('dashboard.card.running', { n: stats.running })}
              {stats.blocked > 0 ? (
                <>
                  {' · '}
                  <span className="text-worky-blocked">
                    {t('dashboard.card.blocked', { n: stats.blocked })}
                  </span>
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t('dashboard.card.progress')}</span>
            <span data-testid="stream-card-progress">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {hasBudget ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t('dashboard.card.budget')}</span>
              <span>
                ${budget.spendUsd.toFixed(2)} / ${budget.limitUsd.toFixed(2)}
              </span>
            </div>
            <Progress value={budgetPct} className="h-1.5" />
          </div>
        ) : null}
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'absolute right-2 top-2 size-7 text-muted-foreground opacity-0 transition-opacity',
          'hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100',
        )}
        aria-label={t('dashboard.deleteStream', { title: stream.title })}
        disabled={isDeleting}
        onClick={onDelete}
      >
        {isDeleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
