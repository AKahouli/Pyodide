import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle } from 'lucide-react';
import type { TaskResult, StepStatus } from '../types';

const statusIcons: Record<StepStatus, { icon: React.ElementType; className: string }> = {
  pending: { icon: Circle, className: 'text-muted-foreground' },
  running: { icon: Loader2, className: 'text-primary animate-spin' },
  completed: { icon: CheckCircle2, className: 'text-green-600' },
  failed: { icon: XCircle, className: 'text-destructive' },
  skipped: { icon: CornerDownRight, className: 'text-muted-foreground' },
  interrupted: { icon: PauseCircle, className: 'text-yellow-600' },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  taskResults: TaskResult[];
  selectedStepId: string | null;
  onSelectStep: (taskId: string) => void;
}

export function ExecutionStepList({ taskResults, selectedStepId, onSelectStep }: Props) {
  const sortedResults = [...taskResults].sort((a, b) => a.order - b.order);

  return (
    <div className="w-80 border-r overflow-y-auto bg-background">
      <div className="p-3">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Steps</h3>
        <div className="space-y-1">
          {sortedResults.map((result) => {
            const config = statusIcons[result.status] || statusIcons.pending;
            const Icon = config.icon;
            const isSelected = result.taskId === selectedStepId;

            return (
              <div
                key={result.taskId}
                className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
                  isSelected ? 'bg-accent' : 'hover:bg-muted/50'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left"
                  onClick={() => onSelectStep(result.taskId)}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${config.className}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{result.nodeTitle}</p>
                    {result.agentName && (
                      <p className="text-xs text-muted-foreground truncate">{result.agentName}</p>
                    )}
                    {result.isStale && (
                      <p className="text-xs text-amber-700 truncate mt-0.5">Stale result</p>
                    )}
                    {result.status === 'failed' && result.error && (
                      <p className="text-xs text-destructive truncate mt-0.5">{result.error}</p>
                    )}
                  </div>
                  {result.durationMs !== null && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDuration(result.durationMs)}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
