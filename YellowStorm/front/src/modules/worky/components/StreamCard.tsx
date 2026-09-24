import type { JSX } from 'react';
import { ArrowUpRight, Clock, Loader2, Share2, Trash2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { WorkyStreamListItem } from '../types';
import { formatElapsedMinutes } from '../streamStats';
import { StatusBadge } from './StatusBadge';
import { useBoard } from '../query/hooks';
import { deriveExecutiveView } from '../executive/deriveExecutiveView';
import { formatRelativeTime } from '../taskTime';

interface StreamCardProps {
  stream: WorkyStreamListItem;
  onOpen: () => void;
  onDelete: () => void;
  onShare: () => void;
  isDeleting: boolean;
}

/**
 * A single stream tile on the home page: status, elapsed active time, live task
 * rollup, progress meter and (when a budget is set) a slim spend line.
 */
export function StreamCard({ stream, onOpen, onDelete, onShare, isDeleting }: StreamCardProps): JSX.Element {
  const { t, language } = useModuleTranslation('worky');
  const { stats, budget } = stream;
  const access = stream.access ?? 'owner';
  const progressPct = Math.round((stats.progress || 0) * 100);
  const hasBudget = budget.limitUsd > 0;
  const budgetPct = hasBudget ? Math.min(100, Math.round((budget.spendUsd / budget.limitUsd) * 100)) : 0;
  const board = useBoard(['completed', 'archived', 'stopped'].includes(stream.status) ? null : stream.id);
  const model = board.data ? deriveExecutiveView(board.data, stream.status) : null;
  const path = model?.deliveryPaths.find((item) => item.task.lane !== 'done');
  const focus = model?.currentWork.find((item) => item.status === 'failed' || item.status === 'blocked' || item.status === 'needs_input') ?? model?.currentWork.find((item) => item.status === 'running' || item.status === 'review' || item.status === 'pending');
  const reason = stats.failed > 0 ? t('command.portfolio.failed', { count: stats.failed }) : stats.blocked > 0 ? t('command.portfolio.blocked', { count: stats.blocked }) : t(`badges.status.${stream.status}` as 'badges.status.active');
  const lastActivity = formatRelativeTime(stream.lastActivityAt, language);

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
      <button
        type="button"
        data-testid="stream-card-open"
        onClick={onOpen}
        className="flex flex-col gap-3 text-left"
      >
        <div className="flex items-center justify-between gap-2 pr-16">
          <StatusBadge status={stream.status} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            {formatElapsedMinutes(stream.activeDurationMinutes)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold text-foreground">{stream.title}</span>
          {access !== 'owner' ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t(`sharing.${access}`)}
            </span>
          ) : null}
        </div>

        <p className='text-xs font-medium text-foreground'>{reason}</p>
        {path && <p className='line-clamp-2 text-xs text-muted-foreground'>{t('command.portfolio.nextDelivery', { task: path.task.title, done: path.completed, total: path.total })}</p>}
        {focus && <p className='line-clamp-2 text-xs text-muted-foreground'>{t('command.portfolio.nextAction', { task: focus.task.title })}{focus.task.assigneeName || focus.task.assigneeKey ? ` · ${focus.task.assigneeName || focus.task.assigneeKey}` : ''}</p>}
        {lastActivity && <p className='text-[11px] text-muted-foreground'>{t('command.portfolio.updated', { time: lastActivity })}</p>}

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
        <span className='inline-flex items-center gap-1 text-xs font-semibold text-primary'>{t(stats.failed || stats.blocked ? 'command.portfolio.review' : 'command.portfolio.open')}<ArrowUpRight className='size-3.5' /></span>
      </button>

      {access === 'owner' ? <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-9 top-2 size-7 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={t('sharing.open', { title: stream.title })}
        onClick={onShare}
      >
        <Share2 className="size-3.5" />
      </Button> : null}

      {access === 'owner' ? <Button
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
      </Button> : null}
    </div>
  );
}
