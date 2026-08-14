import { useModuleTranslation } from '@/modules/localization';
import { AlertCircle, Clock } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { TaskTimestamp } from './TaskTimestamp';
import { laneToOrch } from '../status';
import type { WorkyTask } from '../types';

interface KanbanCardProps {
  task: WorkyTask;
}

export function KanbanCard({ task }: KanbanCardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <article className='rounded-md border border-border/60 bg-background/70 p-3 text-sm shadow-sm'>
      <header className='mb-1 flex items-start justify-between gap-2'>
        <h3 className='font-medium leading-snug'>{task.title}</h3>
        <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
          {t(`kanban.priorities.${task.priority}`)}
        </span>
      </header>
      {task.description ? (
        <p className='line-clamp-3 text-xs text-muted-foreground'>{task.description}</p>
      ) : null}
      <footer className='mt-2 flex items-center justify-between text-[10px] text-muted-foreground'>
        <span>{t(`kanban.assignees.${task.assigneeType}`)}</span>
        <StatusBadge status={laneToOrch(task.lane)} />
        {task.theoreticalDeadlineAt ? (
          <span className='flex items-center gap-1'>
            <Clock className='h-3 w-3' aria-hidden />
            {new Date(task.theoreticalDeadlineAt).toLocaleDateString()}
          </span>
        ) : null}
      </footer>
      <TaskTimestamp task={task} className='mt-1.5' />
      {task.blockerReason ? (
        <p className='mt-2 flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300'>
          <AlertCircle className='h-3 w-3' aria-hidden />
          {task.blockerReason}
        </p>
      ) : null}
    </article>
  );
}
