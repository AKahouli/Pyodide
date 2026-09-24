import { useEffect, useRef, useState, type JSX } from 'react';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { WorkyCurrentWorkItem } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';
import { formatRelativeTime } from '../../taskTime';

type View = 'attention' | 'active' | 'upNext' | 'completed';
const needsReview = (item: WorkyCurrentWorkItem) => ['needs_input', 'failed', 'blocked', 'waiting_external'].includes(item.status);

export function CurrentWorkSection({ items, completed = [], onTaskClick, attention, focusAttention = true }: { items: WorkyCurrentWorkItem[]; completed?: WorkyTask[]; onTaskClick: (task: WorkyTask) => void; attention?: { taskId: string; sequence: number } | null; focusAttention?: boolean }): JSX.Element {
  const { t, language } = useModuleTranslation('worky');
  const [view, setView] = useState<View>('attention');
  const userSelected = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!items.length || userSelected.current) return;
    setView(items.some(needsReview) ? 'attention' : items.some((item) => item.status === 'running' || item.status === 'review') ? 'active' : 'upNext');
  }, [items]);
  useEffect(() => {
    if (!attention || !focusAttention) return;
    setView('attention');
    const id = window.setTimeout(() => {
      const row = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>('[data-worky-task-id]') ?? [])]
        .find((button) => button.dataset.workyTaskId === attention.taskId);
      row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      row?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [attention, focusAttention]);
  const groups: Record<View, WorkyTask[]> = {
    attention: items.filter(needsReview).map((item) => item.task),
    active: items.filter((item) => item.status === 'running' || item.status === 'review').map((item) => item.task),
    upNext: items.filter((item) => item.status === 'pending').map((item) => item.task),
    completed,
  };
  const byId = new Map(items.map((item) => [item.task.id, item]));
  return <section ref={sectionRef} data-testid='worky-work-table' className='min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
    <h2 className='mb-3 flex items-center gap-2 text-sm font-bold text-foreground'><ListChecks className='size-4 text-primary' />{t('executive.currentWork.title')}</h2>
    <div role='status' className='sr-only'>{attention ? t('executive.currentWork.newAttention', { task: items.find((item) => item.task.id === attention.taskId)?.task.title ?? '' }) : null}</div>
    <div className='mb-3 flex gap-1 overflow-x-auto border-b border-border/60 pb-2' role='group' aria-label={t('executive.currentWork.title')}>
      {(['attention', 'active', 'upNext', 'completed'] as const).map((key) => <button key={key} type='button' aria-pressed={view === key} onClick={() => { userSelected.current = true; setView(key); }} className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-primary', view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        {t(`command.table.${key}`)} <span className='tabular-nums opacity-75'>{groups[key].length}</span>
      </button>)}
    </div>
    <div className='hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-3 border-b border-border/60 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid'>
      <span>{t('command.table.task')}</span><span>{t('command.table.owner')}</span><span>{t('command.table.dependency')}</span><span>{t('command.table.updated')}</span>
    </div>
    {groups[view].length ? <div className='divide-y divide-border/50'>
      {groups[view].map((task) => {
        const item = byId.get(task.id);
        const dependency = item?.openPrerequisites[0];
        const hasDependencyIssue = Boolean(dependency || item?.canceledPrerequisites || item?.unavailablePrerequisites);
        const pendingStatus = item?.status === 'pending' ? hasDependencyIssue ? 'waitingPrerequisite' : task.lane === 'ready' ? 'ready' : 'queued' : null;
        const dependencyIssues = [
          dependency ? t('executive.currentWork.waitingOn', { task: dependency.title }) : null,
          item?.canceledPrerequisites ? t('executive.currentWork.canceledDependencies', { count: item.canceledPrerequisites }) : null,
          item?.unavailablePrerequisites ? t('executive.currentWork.unavailableDependencies', { count: item.unavailablePrerequisites }) : null,
        ].filter(Boolean);
        const dependencyLabel = dependencyIssues.length ? dependencyIssues.join(' · ') : item?.status === 'pending' ? t('command.table.noDependency') : '';
        return <button key={task.id} type='button' data-worky-task-id={task.id} onClick={() => onTaskClick(task)} className={cn('grid w-full gap-1 py-3 text-left hover:bg-muted/40 focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-center sm:gap-3', attention?.taskId === task.id && 'rounded-md bg-amber-500/10 px-2 ring-2 ring-amber-500')}>
          <span className='min-w-0'><span className='block truncate text-sm font-medium text-foreground' title={task.title}>{task.title}</span><span className='text-xs text-muted-foreground'>{t(pendingStatus ? `command.table.${pendingStatus}` : item ? `executive.workStatus.${item.status}` : 'command.table.done')}</span></span>
          <span className='truncate text-xs text-muted-foreground'>{task.assigneeName || task.assigneeKey || t('command.queue.unassigned')}</span>
          <span className='truncate text-xs text-muted-foreground' title={item?.openPrerequisites.map((dep) => dep.title).join(', ')}>{dependencyLabel}</span>
          <span className='flex items-center justify-between gap-2 text-xs text-muted-foreground'><span>{task.updatedAt || task.completedAt || task.createdAt ? formatRelativeTime(task.updatedAt ?? task.completedAt ?? task.createdAt ?? '', language) : '—'}</span><ArrowUpRight className='size-3.5 shrink-0' /></span>
        </button>;
      })}
    </div> : <p className='py-4 text-xs text-muted-foreground'>{t(`command.table.empty.${view}`)}</p>}
  </section>;
}
