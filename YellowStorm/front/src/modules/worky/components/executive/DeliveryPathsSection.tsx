import { useState, type JSX } from 'react';
import { ArrowUpRight, GitBranch } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyDeliveryPath } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

export function DeliveryPathsSection({ paths, onTaskClick }: { paths: WorkyDeliveryPath[]; onTaskClick: (task: WorkyTask) => void }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const [expanded, setExpanded] = useState(false);
  if (!paths.length) return null;
  const visible = expanded ? paths : paths.slice(0, 3);
  return <section className='min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
    <h2 className='mb-1 flex items-center gap-2 text-sm font-bold text-foreground'><GitBranch className='size-4 text-primary' />{t('command.paths.title')}</h2>
    <p className='mb-3 text-xs text-muted-foreground'>{t('command.paths.description')}</p>
    <div className='divide-y divide-border/60'>
      {visible.map((path) => <div key={path.task.id} className='py-3 first:pt-0 last:pb-0'>
        <div className='flex items-start justify-between gap-3'>
          <p className='min-w-0 flex-1 text-sm font-semibold text-foreground'>{path.task.title}</p>
          <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{path.completed}/{path.total}</span>
        </div>
        <div className='mt-2 h-1 rounded-full bg-muted'><div className='h-full rounded-full bg-primary' style={{ width: `${path.total ? path.completed / path.total * 100 : 0}%` }} /></div>
        <div className='mt-2 flex items-center justify-between gap-2'>
          <span className='min-w-0 truncate text-xs text-muted-foreground'>{path.nextTask ? t('command.paths.next', { task: path.nextTask.title }) : t('command.paths.complete')}</span>
          {path.nextTask && <button type='button' onClick={() => onTaskClick(path.nextTask as WorkyTask)} className='flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:underline'>{t('command.paths.inspect')}<ArrowUpRight className='size-3' /></button>}
        </div>
      </div>)}
    </div>
    {paths.length > 3 && <button type='button' onClick={() => setExpanded((value) => !value)} className='mt-3 text-xs font-semibold text-primary hover:underline focus-visible:underline'>{t(expanded ? 'command.paths.less' : 'command.paths.more', { count: paths.length })}</button>}
  </section>;
}
