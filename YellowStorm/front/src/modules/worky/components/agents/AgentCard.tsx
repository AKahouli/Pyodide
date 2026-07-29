import type { JSX } from 'react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AgentAvatar } from './AgentAvatar';
import { AgentStatusPill } from './AgentStatusPill';
import type { WorkyAgent } from '../../agents/agentModel';

export function AgentCard({
  agent,
  onOpen,
  className,
}: {
  agent: WorkyAgent;
  onOpen: (agent: WorkyAgent) => void;
  className?: string;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const pct = agent.totalCount > 0 ? Math.round((agent.doneCount / agent.totalCount) * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(agent);
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <AgentAvatar initials={agent.initials} colorSeed={agent.colorSeed} status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">{agent.name}</div>
          {agent.role ? <div className="truncate text-xs text-muted-foreground">{agent.role}</div> : null}
        </div>
        <AgentStatusPill status={agent.status} />
      </div>

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
    </div>
  );
}
