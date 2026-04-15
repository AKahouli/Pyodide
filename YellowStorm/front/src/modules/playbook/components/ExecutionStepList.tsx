import { Circle, Loader2, CheckCircle2, XCircle, CornerDownRight, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
    <div className="w-28 border-r overflow-y-auto bg-background">
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
                aria-label={`Step ${result.order}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-primary/30 bg-primary/10 shadow-sm'
                    : 'border-transparent hover:border-border hover:bg-muted/40',
                )}
                onClick={() => onSelectStep(result.taskId)}
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
                    {result.order}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
