import type { JSX } from 'react';
import { ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentStatusPill } from '../agents/AgentStatusPill';
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
 * Shows one agent's task list (each task's title + lane/status). Selecting a
 * task hands it up to open the full task detail. Used on both mobile and
 * desktop so the agent group opens a task overview, not a single task.
 */
export function AgentTasksSheet({
  agent,
  open,
  onOpenChange,
  onOpenTask,
}: {
  agent: WorkyAgent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (task: WorkyTask) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{agent?.name ?? ''}</SheetTitle>
        </SheetHeader>
        {agent ? (
          <div className="flex flex-col gap-4 pt-1">
            <div className="flex items-center gap-3">
              <AgentAvatar initials={agent.initials} colorSeed={agent.colorSeed} status={agent.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-foreground">{agent.name}</div>
                {agent.role ? <div className="truncate text-xs text-muted-foreground">{agent.role}</div> : null}
              </div>
              <AgentStatusPill status={agent.status} />
            </div>

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('agents.tasks.heading', { count: agent.totalCount })}
            </div>

            <div className="flex flex-col gap-2">
              {agent.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                >
                  <span className={cn('size-2 shrink-0 rounded-full', laneDot(task.lane))} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
                    <div className="text-xs text-muted-foreground">{t(`kanban.lanes.${task.lane}` as 'kanban.lanes.running')}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
