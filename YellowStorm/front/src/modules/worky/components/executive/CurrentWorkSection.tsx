import type { JSX } from 'react';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyCurrentWorkItem } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

export function CurrentWorkSection({ items, onTaskClick }: { items: WorkyCurrentWorkItem[]; onTaskClick: (task: WorkyTask) => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <section className='rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <ListChecks className='size-4 text-primary' />
        {t('executive.currentWork.title')}
      </h2>
      {items.length === 0 ? <p className='text-sm text-muted-foreground'>{t('executive.currentWork.empty')}</p> : (
        <div className='divide-y divide-border/60'>
          {items.map(({ task, status }) => (
            <button key={task.id} type='button' onClick={() => onTaskClick(task)} className='flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0'>
              <span className='size-2 shrink-0 rounded-full bg-primary' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium text-foreground'>{task.title}</span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {t(`executive.workStatus.${status}`)}{task.assigneeName || task.assigneeKey ? ` · ${task.assigneeName || task.assigneeKey}` : ''}
                </span>
              </span>
              <ArrowUpRight className='size-4 text-muted-foreground' />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
