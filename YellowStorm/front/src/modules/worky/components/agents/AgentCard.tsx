import type { JSX } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AgentAvatar } from './AgentAvatar';
import { AgentStatusPill } from './AgentStatusPill';
import type { WorkyAgent } from '../../agents/agentModel';
import type { WorkyTask } from '../../types';

const LANE_DOT: Record<string, string> = {
  running: 'bg-worky-working',
  review: 'bg-worky-working',
  blocked: 'bg-worky-blocked',
  done: 'bg-worky-done',
  failed: 'bg-destructive',
  canceled: 'bg-muted-foreground',
};
const laneDot = (lane: string): string => LANE_DOT[lane] ?? 'bg-worky-idle';

/**
 * One agent in the team view. The card expands in place to reveal that agent's
 * tasks — the caller owns the open state so only one card is expanded at a
 * time. Selecting a task hands it up to open the full task detail.
 */
export function AgentCard({
  agent,
  expanded,
  onToggle,
  onOpenTask,
  className,
}: {
  agent: WorkyAgent;
  expanded: boolean;
  onToggle: (agent: WorkyAgent) => void;
  onOpenTask: (task: WorkyTask) => void;
  className?: string;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const pct = agent.totalCount > 0 ? Math.round((agent.doneCount / agent.totalCount) * 100) : 0;
  const panelId = `agent-tasks-${agent.key}`;

  return (
    <div
      className={cn(
        'flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(agent)}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid={`agent-card-toggle-${agent.key}`}
        className="flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-accent/40"
      >
        <AgentAvatar initials={agent.initials} colorSeed={agent.colorSeed} status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">{agent.name}</div>
          {agent.role ? <div className="truncate text-xs text-muted-foreground">{agent.role}</div> : null}
        </div>
        <AgentStatusPill status={agent.status} />
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            agent.status === 'working' ? 'bg-worky-working' : 'bg-muted-foreground/50',
          )}
        />
        <span className="truncate text-[13px] text-muted-foreground">
          {agent.currentTask?.title ?? t('agents.card.standingBy')}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {t('agents.card.tasksProgress', { done: agent.doneCount, total: agent.totalCount })}
          </span>
          <span className="font-semibold text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('agents.tasks.heading', { count: agent.totalCount })}
          </div>
          {agent.tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task)}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3 text-left transition-colors hover:bg-accent/40"
            >
              <span className={cn('size-2 shrink-0 rounded-full', laneDot(task.lane))} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`kanban.lanes.${task.lane}` as 'kanban.lanes.running')}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
