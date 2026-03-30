import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
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
  pageMode?: 'design' | 'run';
}

export function ExecutionStepList({ taskResults, selectedStepId, onSelectStep, pageMode = 'run' }: Props) {
  const { t } = useModuleTranslation('playbook');
  const sortedResults = [...taskResults].sort((a, b) => a.order - b.order);

  return (
    <div className="w-80 border-r overflow-y-auto bg-background">
      <div className="p-3">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('execution.steps')}</h3>
        <div className="space-y-1">
          {sortedResults.map((result) => {
            const config = statusIcons[result.status] || statusIcons.pending;
            const Icon = config.icon;
            const isSelected = result.taskId === selectedStepId;

            return (
              <button
                type="button"
                key={result.taskId}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-primary/30 bg-primary/10 shadow-sm'
                    : 'border-transparent hover:border-border hover:bg-muted/40',
                )}
                onClick={() => onSelectStep(result.taskId)}
              >
                <div
                  className={cn(
                    'mt-0.5 h-10 w-1 shrink-0 rounded-full bg-transparent transition-colors',
                    isSelected && 'bg-primary/70',
                  )}
                />
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.className}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn('truncate text-sm font-medium', isSelected ? 'text-foreground' : 'text-foreground/90')}>
                      {result.nodeTitle}
                    </p>
                    {result.durationMs !== null && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDuration(result.durationMs)}
                      </span>
                    )}
                  </div>
                  {result.agentName && (
                    <p className="truncate text-xs text-muted-foreground">{result.agentName}</p>
                  )}
                  {result.isStale && (
                    <p className="mt-0.5 truncate text-xs text-amber-700">{t('execution.staleResult')}</p>
                  )}
                  {result.status === 'failed' && result.error && (
                    <p className="mt-0.5 truncate text-xs text-destructive">{result.error}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
