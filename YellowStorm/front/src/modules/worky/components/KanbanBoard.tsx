import type { DragEvent } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkyBoard, useWorkyBoardLoading, useWorkyBoardError } from '../store';
import { useTaskOps } from '../query/hooks';
import { KanbanCard } from './KanbanCard';
import type { WorkyTask } from '../types';
import { ORCH_LANES, toOrchColumns, orchDropLane, type OrchStepStatus } from '../status';
import { cn } from '@/lib/utils';

interface KanbanBoardProps {
  streamId: string;
  onTaskClick?: (task: WorkyTask) => void;
}

export function KanbanBoard({ streamId, onTaskClick }: KanbanBoardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const board = useWorkyBoard();
  const loading = useWorkyBoardLoading();
  const error = useWorkyBoardError();
  const taskOps = useTaskOps(streamId);

  // Columns are the orchestrator step statuses; tasks are aggregated from the
  // legacy lanes. A drop maps the orchestrator column back to a canonical
  // legacy lane so the backend move API is unchanged.
  const columns = toOrchColumns(board);

  const handleDrop = (lane: OrchStepStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('application/x-worky-task-id');
    const sourceLane = event.dataTransfer.getData('application/x-worky-source-lane');
    if (!taskId || sourceLane === lane) return;
    taskOps.move.mutate({ taskId, lane: orchDropLane(lane), reason: 'owner-kanban-move' });
  };

  if (loading && !board) {
    return (
      <div className='flex h-full flex-1 items-center justify-center text-sm text-muted-foreground'>
        {t('kanban.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div className='flex h-full flex-1 items-center justify-center text-sm text-destructive'>
        {t('kanban.error')}
      </div>
    );
  }
  return (
    <div
      data-testid='worky-kanban-board'
      className='flex h-full flex-1 items-stretch gap-2 overflow-x-auto p-4'
    >
      {ORCH_LANES.map((lane) => {
        const tasks: WorkyTask[] = columns[lane];
        const isEmpty = tasks.length === 0;
        return (
          <section
            key={lane}
            data-testid={`worky-lane-${lane}`}
            data-empty={isEmpty}
            aria-label={t(`kanban.lanes.${lane}`)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(lane, event)}
            className={cn(
              'flex shrink-0 flex-col rounded-md border border-border/60 transition-colors',
              isEmpty
                ? 'h-16 w-40 self-start bg-background/20 opacity-70'
                : 'h-full w-64 bg-background/30',
            )}
          >
            <header className='flex items-center justify-between border-b border-border/60 px-3 py-2'>
              <h2 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                {t(`kanban.lanes.${lane}`)}
              </h2>
              <span className='text-[10px] text-muted-foreground'>{tasks.length}</span>
            </header>
            {isEmpty ? null : (
              <div className='flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-2'>
                {tasks.map((task) => (
                  <button
                    type='button'
                    key={task.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-worky-task-id', task.id);
                      event.dataTransfer.setData('application/x-worky-source-lane', lane);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onTaskClick?.(task)}
                    className='w-full text-left'
                  >
                    <KanbanCard task={task} />
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
