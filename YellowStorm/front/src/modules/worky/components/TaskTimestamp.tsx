import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { resolveTaskTime, formatRelativeTime } from '../taskTime';
import type { WorkyTask } from '../types';

type TaskTimeInput = Pick<WorkyTask, 'lane' | 'createdAt' | 'updatedAt' | 'startedAt' | 'completedAt'>;

/**
 * Compact "created/started/done X ago" label for a task card. Contextual to the
 * task's lane (see resolveTaskTime) and localized. Renders nothing when there is
 * no usable timestamp, so it is safe to drop into any card unconditionally.
 */
export function TaskTimestamp({ task, className }: { task: TaskTimeInput; className?: string }): JSX.Element | null {
  const { t, language } = useModuleTranslation('worky');
  const resolved = resolveTaskTime(task);
  if (!resolved) return null;
  const time = formatRelativeTime(resolved.iso, language);
  if (!time) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[10px] text-muted-foreground', className)}
      title={new Date(resolved.iso).toLocaleString(language)}
      data-testid="worky-task-timestamp"
    >
      <Clock className="h-3 w-3" aria-hidden />
      {t(`taskTime.${resolved.kind}` as 'taskTime.created', { time })}
    </span>
  );
}
