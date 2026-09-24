import type { JSX } from 'react';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyCurrentWorkItem } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

export function AttentionQueue({ items, onTaskClick }: { items: WorkyCurrentWorkItem[]; onTaskClick: (task: WorkyTask) => void }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const urgent = items.filter((item) => item.status === 'failed' || item.status === 'blocked');
  const waiting = items.filter((item) => item.status === 'waiting_external');
  if (!urgent.length && !waiting.length) return null;
  return <section id='worky-attention-queue' className='rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
    <div className='mb-3 flex items-center justify-between gap-3'>
      <h2 className='flex items-center gap-2 text-sm font-bold text-foreground'><ShieldAlert className='size-4 text-amber-500' />{t('command.queue.title')}</h2>
      <span className='text-xs tabular-nums text-muted-foreground'>{t('command.queue.count', { count: urgent.length })}</span>
    </div>
    <div className='divide-y divide-border/60'>
      {[...urgent, ...waiting].map((item) => {
        const rawReason = item.task.blockedReason || (item.task.blockerReason?.startsWith('clarification:') ? null : item.task.blockerReason);
        const reason = rawReason && /^[A-Za-z]+(?:Error|Exception):/.test(rawReason) ? t('command.queue.executionError') : rawReason;
        const owner = item.task.assigneeName || item.task.assigneeKey;
        return <div key={item.task.id} className='grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <span className={`size-2 shrink-0 rounded-full ${item.status === 'waiting_external' ? 'bg-sky-500' : 'bg-amber-500'}`} />
              <p className='truncate text-sm font-semibold text-foreground' title={item.task.title}>{item.task.title}</p>
            </div>
            <p className='mt-1 pl-4 text-xs text-muted-foreground'>{t(`executive.workStatus.${item.status}`)}{owner ? ` · ${owner}` : ''}{item.downstreamCount ? ` · ${t('command.queue.downstream', { count: item.downstreamCount })}` : ''}</p>
            {reason && <p className='mt-1 line-clamp-2 pl-4 text-xs text-amber-600 dark:text-amber-400'>{reason}</p>}
          </div>
          <button type='button' onClick={() => onTaskClick(item.task)} className='inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary'>
            {t(item.status === 'waiting_external' ? 'command.queue.inspectWait' : 'command.queue.investigate')}<ArrowUpRight className='size-3.5' />
          </button>
        </div>;
      })}
    </div>
  </section>;
}
