import { useEffect, useRef, useState, type JSX } from 'react';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyCurrentWorkItem } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

const ATTENTION = new Set(['needs_input', 'failed', 'blocked', 'waiting_external']);
const ACTIVE = new Set(['running', 'review']);

export function CurrentWorkSection({ items, onTaskClick, attention, focusAttention = true }: { items: WorkyCurrentWorkItem[]; onTaskClick: (task: WorkyTask) => void; attention?: { taskId: string; sequence: number } | null; focusAttention?: boolean }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [showAllRemaining, setShowAllRemaining] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!attention || !focusAttention) return;
    const row = [...(sectionRef.current?.querySelectorAll<HTMLButtonElement>('[data-worky-task-id]') ?? [])]
      .find((button) => button.dataset.workyTaskId === attention.taskId);
    row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    row?.focus({ preventScroll: true });
  }, [attention, focusAttention]);
  const attentionItems = items.filter((item) => ATTENTION.has(item.status));
  const active = items.filter((item) => ACTIVE.has(item.status));
  const remaining = items.filter((item) => item.status === 'pending');

  const groups = [
    { key: 'attention', items: attentionItems, tone: 'bg-amber-500' },
    { key: 'active', items: active, tone: 'bg-primary' },
    { key: 'remaining', items: showAllRemaining ? remaining : remaining.slice(0, 4), tone: 'bg-muted-foreground' },
  ] as const;

  return (
    <section ref={sectionRef} className='min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <ListChecks className='size-4 text-primary' />{t('executive.currentWork.title')}
      </h2>
      <div role='status' className='sr-only'>{attention ? t('executive.currentWork.newAttention', { task: items.find((item) => item.task.id === attention.taskId)?.task.title ?? '' }) : null}</div>
      <div className='space-y-5'>
        {groups.map(({ key, items: groupItems, tone }) => (
          <div key={key}>
            <h3 className='mb-2 flex items-center justify-between border-b border-border/60 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              <span>{t(`executive.currentWork.${key}`)}</span>
              <span className='tabular-nums'>{key === 'remaining' ? remaining.length : groupItems.length}</span>
            </h3>
            {groupItems.length ? <div className='divide-y divide-border/50'>{groupItems.map((item) => <WorkRow key={item.task.id} item={item} tone={tone} highlighted={item.task.id === attention?.taskId} onClick={() => onTaskClick(item.task)} />)}</div> : (
              <p className='py-2 text-xs text-muted-foreground'>{t(`executive.currentWork.${key}Empty`)}</p>
            )}
            {key === 'remaining' && remaining.length > 4 && (
              <button type='button' className='mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:underline' onClick={() => setShowAllRemaining((value) => !value)}>
                {t(showAllRemaining ? 'executive.currentWork.showLess' : 'executive.currentWork.showAll', { count: remaining.length })}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkRow({ item, tone, highlighted, onClick }: { item: WorkyCurrentWorkItem; tone: string; highlighted: boolean; onClick: () => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { task, status, openPrerequisites, canceledPrerequisites, unavailablePrerequisites } = item;
  const owner = task.assigneeName || task.assigneeKey;
  const blocker = task.blockedReason || (task.blockerReason?.startsWith('clarification:') ? null : task.blockerReason);
  const firstDependency = openPrerequisites[0];
  const otherDependencies = openPrerequisites.length - 1;

  return (
    <button type='button' data-worky-task-id={task.id} onClick={onClick} className={`group flex w-full items-start gap-3 py-3 text-left first:pt-0 last:pb-0 focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-primary ${highlighted ? 'rounded-md bg-amber-500/10 px-2 ring-2 ring-amber-500' : ''}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone}`} aria-hidden />
      <span className='min-w-0 flex-1 space-y-1'>
        <span className='block truncate text-sm font-medium text-foreground' title={task.title}>{task.title}</span>
        <span className='block truncate text-xs text-muted-foreground'>{t(`executive.workStatus.${status}`)}{owner ? ` · ${owner}` : ''}</span>
        {blocker && ATTENTION.has(status) && <span className='block line-clamp-2 text-xs text-amber-600 dark:text-amber-400'>{blocker}</span>}
        {firstDependency && <span className='block truncate text-xs text-muted-foreground' title={openPrerequisites.map((dependency) => dependency.title).join(', ')}>
          {t('executive.currentWork.waitingOn', { task: firstDependency.title })}{otherDependencies ? ` ${t('executive.currentWork.andMore', { count: otherDependencies })}` : ''}
        </span>}
        {canceledPrerequisites > 0 && <span className='block text-xs text-amber-600 dark:text-amber-400'>{t('executive.currentWork.canceledDependencies', { count: canceledPrerequisites })}</span>}
        {unavailablePrerequisites > 0 && <span className='block text-xs text-muted-foreground'>{t('executive.currentWork.unavailableDependencies', { count: unavailablePrerequisites })}</span>}
      </span>
      <ArrowUpRight className='mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground' aria-hidden />
    </button>
  );
}
