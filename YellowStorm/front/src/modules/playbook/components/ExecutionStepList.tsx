import { useState } from 'react';
import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle, Clock, GitBranch, Hand, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { TaskResult, StepStatus } from '../types';

interface RouterDecision {
  nodeId: string;
  label: string;
  iteration: number;
}

const statusIcons: Record<StepStatus, { icon: React.ElementType; className: string }> = {
  pending: { icon: Circle, className: 'text-muted-foreground' },
  running: { icon: Loader2, className: 'text-primary animate-spin' },
  completed: { icon: CheckCircle2, className: 'text-green-600' },
  cancelled: { icon: XCircle, className: 'text-muted-foreground' },
  failed: { icon: XCircle, className: 'text-destructive' },
  skipped: { icon: CornerDownRight, className: 'text-muted-foreground' },
  interrupted: { icon: PauseCircle, className: 'text-yellow-600' },
  queued: { icon: Clock, className: 'text-muted-foreground' },
  pending_approval: { icon: Hand, className: 'text-yellow-600' },
};

interface TaskGroup {
  taskId: string;
  iterations: TaskResult[];
  minOrder: number;
}

interface Props {
  taskResults: TaskResult[];
  selectedStepId: string | null;
  selectedIterationIndex?: number;
  onSelectStep: (taskId: string, iterationIndex?: number) => void;
  pageMode?: 'design' | 'run';
  routerDecisions?: RouterDecision[];
}

function groupByTaskId(results: TaskResult[]): TaskGroup[] {
  const map = new Map<string, TaskResult[]>();
  for (const r of results) {
    const arr = map.get(r.taskId);
    if (arr) {
      arr.push(r);
    } else {
      map.set(r.taskId, [r]);
    }
  }
  const groups: TaskGroup[] = [];
  for (const [taskId, iterations] of map) {
    iterations.sort((a, b) => a.order - b.order);
    groups.push({ taskId, iterations, minOrder: Math.min(...iterations.map((r) => r.order)) });
  }
  groups.sort((a, b) => a.minOrder - b.minOrder);
  return groups;
}

function StepRow({
  result,
  isSelected,
  showOrder,
  onClick,
}: {
  result: TaskResult;
  isSelected: boolean;
  showOrder: number | string;
  onClick: () => void;
}) {
  const config = statusIcons[result.status] || statusIcons.pending;
  const Icon = config.icon;

  return (
    <button
      type="button"
      aria-label={`Step ${result.order}`}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
        isSelected
          ? 'border-primary/30 bg-primary/10 shadow-sm'
          : 'border-transparent hover:border-border hover:bg-muted/40',
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          'h-10 w-1 shrink-0 rounded-full bg-transparent transition-colors',
          isSelected && 'bg-primary/70',
        )}
      />
      <Icon className={`h-4 w-4 shrink-0 ${config.className}`} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            'h-5 min-w-5 shrink-0 justify-center px-1 text-[11px] font-bold',
            isSelected ? 'bg-[#ffcd03] text-black border-[#ffcd03]' : 'bg-primary/10 text-primary border-primary/20',
          )}
        >
          {showOrder}
        </Badge>
      </div>
    </button>
  );
}

export function ExecutionStepList({ taskResults, selectedStepId, selectedIterationIndex, onSelectStep, pageMode = 'run', routerDecisions }: Props) {
  const { t } = useModuleTranslation('playbook');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = groupByTaskId(taskResults);
  const decisionsByTask = new Map<string, RouterDecision[]>();
  if (routerDecisions) {
    for (const d of routerDecisions) {
      const arr = decisionsByTask.get(d.nodeId);
      if (arr) {
        arr.push(d);
      } else {
        decisionsByTask.set(d.nodeId, [d]);
      }
    }
  }

  const toggleExpand = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  return (
    <div className="w-28 border-r overflow-y-auto bg-background">
      <div className="p-3">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('execution.steps')}</h3>
        <div className="space-y-1">
          {groups.map((group) => {
            if (group.iterations.length === 1) {
              const result = group.iterations[0];
              return (
                <StepRow
                  key={result.taskId}
                  result={result}
                  isSelected={result.taskId === selectedStepId}
                  showOrder={result.order}
                  onClick={() => onSelectStep(result.taskId)}
                />
              );
            }

            const firstResult = group.iterations[0];
            const isGroupSelected = group.taskId === selectedStepId;
            const isOpen = expanded.has(group.taskId);
            const Chevron = isOpen ? ChevronDown : ChevronRight;

            return (
              <div key={group.taskId}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
                    isGroupSelected
                      ? 'border-primary/30 bg-primary/10 shadow-sm'
                      : 'border-transparent hover:border-border hover:bg-muted/40',
                  )}
                  onClick={() => toggleExpand(group.taskId)}
                >
                  <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <div
                    className={cn(
                      'h-10 w-1 shrink-0 rounded-full bg-transparent transition-colors',
                      isGroupSelected && 'bg-primary/70',
                    )}
                  />
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 min-w-5 shrink-0 justify-center px-1 text-[11px] font-bold',
                      isGroupSelected ? 'bg-[#ffcd03] text-black border-[#ffcd03]' : 'bg-primary/10 text-primary border-primary/20',
                    )}
                  >
                    {firstResult.order}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {group.iterations.length} {t('execution.iterations').toLowerCase()}
                  </span>
                </button>

                {isOpen && (
                  <div className="ml-4 space-y-0.5 mt-0.5 border-l-2 border-muted pl-2">
                    {group.iterations.map((result, idx) => {
                      const isIterSelected = isGroupSelected && idx === selectedIterationIndex;
                      const taskDecisions = decisionsByTask.get(group.taskId) || [];
                      const prevDecision = idx > 0
                        ? taskDecisions.find((d) => d.iteration === idx)
                        : undefined;

                      return (
                        <div key={`${result.taskId}-${idx}`}>
                          {prevDecision && (
                            <div className="flex items-center gap-1 py-0.5 text-[10px] text-muted-foreground">
                              <GitBranch className="h-3 w-3" />
                              <span>{t('execution.routerDecision', { label: prevDecision.label })}</span>
                            </div>
                          )}
                          <StepRow
                            result={result}
                            isSelected={isIterSelected}
                            showOrder={`#${idx + 1}`}
                            onClick={() => onSelectStep(result.taskId, idx)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
