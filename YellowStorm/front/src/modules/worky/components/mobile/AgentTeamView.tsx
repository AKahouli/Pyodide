import type { JSX } from 'react';
import { Users, SlidersHorizontal } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { AgentCard } from '../agents/AgentCard';
import { useStreamAgents } from '../../agents/useStreamAgents';
import type { WorkyAgent } from '../../agents/agentModel';

/**
 * Mobile agent-team body: the stream's tasks grouped by agent. The manager
 * voice banner and bottom nav are composed by the page around this view.
 */
export function AgentTeamView({ onOpenAgent }: { onOpenAgent: (agent: WorkyAgent) => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { agents, ungrouped } = useStreamAgents();

  if (agents.length === 0 && ungrouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
        <p className="text-sm font-medium text-foreground">{t('agents.team.empty')}</p>
        <p className="text-xs text-muted-foreground">{t('agents.team.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{t('agents.team.title')}</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SlidersHorizontal className="size-3.5" />
          {t('agents.team.sort')}
        </span>
      </div>

      {agents.map((agent) => (
        <AgentCard key={agent.key} agent={agent} onOpen={onOpenAgent} />
      ))}

      {ungrouped.length > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{t('agents.team.unassignedTitle')}</div>
            <div className="text-xs text-muted-foreground">
              {t('agents.team.unassignedCount', { count: ungrouped.length })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
