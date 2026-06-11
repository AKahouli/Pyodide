import { useState } from 'react';
import { GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { TaskResult, StepStatus } from '../types';

interface RouterDecision {
  nodeId: string;
  label: string;
  iteration: number;
}

export function getStepNumberTone(status: StepStatus, isSelected: boolean): string {
  if (status === 'completed') return 'border-emerald-500 bg-emerald-500 text-white';
  if (status === 'failed') return 'border-orange-500 bg-orange-500 text-white';
  if (status === 'running' || status === 'interrupted' || status === 'pending_approval') return 'border-[#ffcd03] bg-[#ffcd03] text-black';
  if (isSelected) return 'border-[#ffcd03] bg-[#ffcd03] text-black';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

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
  taskOrderById?: Map<string, number>;
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
  return (
    <button
      type="button"
      aria-label={`Step ${showOrder}`}
      className={cn(
        'flex w-full items-center justify-center rounded-lg border px-1.5 py-2 text-left transition-colors',
        isSelected
          ? 'border-primary/30 bg-primary/10 shadow-sm'
          : 'border-transparent hover:border-border hover:bg-muted/40',
      )}
      onClick={onClick}
    >
      <div className="flex min-w-0 items-center justify-center">
        <Badge
          variant="outline"
          className={cn(
            'h-6 min-w-6 shrink-0 justify-center px-1 text-[11px] font-bold shadow-sm',
            getStepNumberTone(result.status, isSelected),
          )}
        >
          {showOrder}
        </Badge>
      </div>
    </button>
  );
}

export function ExecutionStepList({ taskResults, selectedStepId, selectedIterationIndex, onSelectStep, pageMode = 'run', routerDecisions, taskOrderById }: Props) {
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
    <div className="w-[72px] border-r overflow-y-auto bg-background">
      <div className="p-2">
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
                  showOrder={taskOrderById?.get(result.taskId) ?? result.order}
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
                    'flex w-full items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-left transition-colors',
                    isGroupSelected
                      ? 'border-primary/30 bg-primary/10 shadow-sm'
                      : 'border-transparent hover:border-border hover:bg-muted/40',
                  )}
                  onClick={() => toggleExpand(group.taskId)}
                >
                  <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-6 min-w-6 shrink-0 justify-center px-1 text-[11px] font-bold shadow-sm',
                      getStepNumberTone(firstResult.status, isGroupSelected),
                    )}
                  >
                    {taskOrderById?.get(firstResult.taskId) ?? firstResult.order}
                  </Badge>
                </button>

                {isOpen && (
                  <div className="space-y-0.5 mt-0.5 pl-1">
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
