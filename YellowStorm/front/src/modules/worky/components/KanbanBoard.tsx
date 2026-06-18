import { useModuleTranslation } from '@/modules/localization';
import { WORKY_LANES } from '../constants';
import { useWorkyBoard, useWorkyBoardLoading, useWorkyBoardError } from '../store';
import { KanbanCard } from './KanbanCard';
import type { WorkyBoardLane, WorkyTask } from '../types';

const VISIBLE_LANES: WorkyBoardLane[] = ['backlog', 'ready', 'running', 'review', 'blocked', 'done'];

interface KanbanBoardProps {
  onTaskClick?: (task: WorkyTask) => void;
}

export function KanbanBoard({ onTaskClick }: KanbanBoardProps = {}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const board = useWorkyBoard();
  const loading = useWorkyBoardLoading();
  const error = useWorkyBoardError();

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
    <div className='flex h-full flex-1 gap-2 overflow-x-auto p-4'>
      {VISIBLE_LANES.map((lane) => {
        const tasks: WorkyTask[] = (board?.[lane] ?? []) as WorkyTask[];
        return (
          <section
            key={lane}
            className='flex h-full w-64 flex-col rounded-md border border-border/60 bg-background/30'
            aria-label={t(`kanban.lanes.${lane}`)}
          >
            <header className='flex items-center justify-between border-b border-border/60 px-3 py-2'>
              <h2 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                {t(`kanban.lanes.${lane}`)}
              </h2>
              <span className='text-[10px] text-muted-foreground'>{tasks.length}</span>
            </header>
            <div className='flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-2'>
              {tasks.length === 0 ? (
                <p className='px-2 py-2 text-center text-xs text-muted-foreground'>
                  {t('kanban.placeholder')}
                </p>
              ) : (
                tasks.map((task) => (
                  <button
                    type='button'
                    key={task.id}
                    onClick={() => onTaskClick?.(task)}
                    className='w-full text-left'
                  >
                    <KanbanCard task={task} />
                  </button>
                ))
              )}
            </div>
          </section>
        );
      })}
      <span data-worky-lanes-count={WORKY_LANES.length} className='hidden' aria-hidden />
    </div>
  );
}
