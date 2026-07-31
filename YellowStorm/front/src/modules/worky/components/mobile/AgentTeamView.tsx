import { useMemo, useState, type JSX } from 'react';
import { Users, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AgentCard } from '../agents/AgentCard';
import { useStreamAgents } from '../../agents/useStreamAgents';
import type { WorkyAgent, WorkyAgentStatus } from '../../agents/agentModel';
import type { WorkyTask } from '../../types';

const SORTS = ['status', 'name', 'progress', 'tasks'] as const;
export type AgentSort = (typeof SORTS)[number];

/** Most-attention-first: blocked agents need the owner, working ones are in
 *  flight, idle ones have nothing running, done ones are finished. */
const STATUS_RANK: Record<WorkyAgentStatus, number> = { blocked: 0, working: 1, idle: 2, done: 3 };

const donePct = (a: WorkyAgent): number => (a.totalCount > 0 ? a.doneCount / a.totalCount : 0);
const byName = (a: WorkyAgent, b: WorkyAgent): number => a.name.localeCompare(b.name);

// Every comparator falls back to name so the order is stable across re-renders
// when the primary key ties.
const COMPARATORS: Record<AgentSort, (a: WorkyAgent, b: WorkyAgent) => number> = {
  status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b),
  name: byName,
  progress: (a, b) => donePct(a) - donePct(b) || byName(a, b),
  tasks: (a, b) => b.totalCount - a.totalCount || byName(a, b),
};

/**
 * Agent-team body: the stream's tasks grouped by agent. Cards expand in place
 * to reveal their tasks, and any number can be open at once so several agents
 * can be compared side by side. `showHeader` renders the "Team" title (mobile);
 * desktop supplies its own and passes `columns={2}`. The sort control shows on
 * both.
 */
export function AgentTeamView({
  onOpenTask,
  showHeader = true,
  columns = 1,
}: {
  onOpenTask: (task: WorkyTask) => void;
  showHeader?: boolean;
  columns?: 1 | 2;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { agents, ungrouped } = useStreamAgents();
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<AgentSort>('status');

  const sortedAgents = useMemo(() => [...agents].sort(COMPARATORS[sort]), [agents, sort]);

  const toggle = (agent: WorkyAgent): void =>
    setExpandedKeys((current) => {
      const next = new Set(current);
      // `delete` reports whether the key was there, so this is toggle-in-place.
      if (!next.delete(agent.key)) next.add(agent.key);
      return next;
    });

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
      <div className={cn('flex items-center', showHeader ? 'justify-between' : 'justify-end')}>
        {showHeader ? (
          <h2 className="text-base font-bold text-foreground">{t('agents.team.title')}</h2>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('agents.sort.label')}
            data-testid="agent-sort-trigger"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <SlidersHorizontal className="size-3.5" />
            {t(`agents.sort.${sort}` as 'agents.sort.status')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => setSort(value as AgentSort)}
            >
              {SORTS.map((option) => (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  data-testid={`agent-sort-${option}`}
                >
                  {t(`agents.sort.${option}` as 'agents.sort.status')}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn('grid items-start gap-3', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {sortedAgents.map((agent) => (
          <AgentCard
            key={agent.key}
            agent={agent}
            expanded={expandedKeys.has(agent.key)}
            onToggle={toggle}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>

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
