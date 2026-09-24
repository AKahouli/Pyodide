import { useEffect, useState, type JSX } from 'react';
import { ArrowUpRight, History } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { changedTasks, snapshotTasks, type TaskSnapshot } from '../../executive/changeDigest';
import type { WorkyTask } from '../../types';
import { TaskTimestamp } from '../TaskTimestamp';

const storageKey = (streamId: string) => `worky:reviewed-tasks:${streamId}`;
function readSnapshot(streamId: string): TaskSnapshot | null {
  try {
    const stored = localStorage.getItem(storageKey(streamId));
    return stored ? JSON.parse(stored) as TaskSnapshot : null;
  } catch { return null; }
}

export function ChangeDigest({ streamId, tasks, recentTasks, onTaskClick }: { streamId: string; tasks: WorkyTask[]; recentTasks: WorkyTask[]; onTaskClick: (task: WorkyTask) => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [previous, setPrevious] = useState<TaskSnapshot | null>(() => readSnapshot(streamId));
  useEffect(() => { setPrevious(readSnapshot(streamId)); }, [streamId]);
  const changed = previous ? changedTasks(tasks, previous) : recentTasks;
  const visible = changed.slice(0, 3);
  const markReviewed = () => {
    const snapshot = snapshotTasks(tasks);
    try { localStorage.setItem(storageKey(streamId), JSON.stringify(snapshot)); } catch { /* Browser storage may be unavailable. */ }
    setPrevious(snapshot);
  };
  return <section className='min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
    <div className='flex items-start justify-between gap-2'>
      <h2 className='flex items-center gap-2 text-sm font-bold text-foreground'><History className='size-4 text-primary' />{t('command.changes.title')}</h2>
      {tasks.length > 0 && <button type='button' onClick={markReviewed} className='shrink-0 text-xs font-semibold text-primary hover:underline focus-visible:underline'>{t(previous ? 'command.changes.markReviewed' : 'command.changes.startTracking')}</button>}
    </div>
    <p className='mt-1 text-xs text-muted-foreground'>{t(previous ? 'command.changes.sinceReview' : 'command.changes.recent')}</p>
    {visible.length ? <div className='mt-3 divide-y divide-border/60'>{visible.map((task) => <button key={task.id} type='button' onClick={() => onTaskClick(task)} className='flex w-full items-center gap-2 py-2 text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-primary'>
      <span className='min-w-0 flex-1'><span className='block truncate text-xs font-medium'>{task.title}</span><TaskTimestamp task={task} /></span><ArrowUpRight className='size-3.5 shrink-0' />
    </button>)}</div> : <p className='mt-3 text-xs text-muted-foreground'>{t('command.changes.empty')}</p>}
    {changed.length > visible.length && <p className='mt-2 text-xs text-muted-foreground'>{t('command.changes.more', { count: changed.length - visible.length })}</p>}
  </section>;
}
