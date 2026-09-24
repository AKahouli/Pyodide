import { useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyTask } from '../../types';
import { AgentTeamView } from '../mobile/AgentTeamView';
import { KanbanBoard } from '../KanbanBoard';
import { WorkyGraphBoard } from '../WorkyGraphBoard';

export function ExecutionDetailsPanel({ streamId, onTaskClick }: { streamId: string; onTaskClick: (task: WorkyTask) => void }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'agents' | 'tasks' | 'map'>('agents');
  return (
    <section className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
      <button type='button' onClick={() => setOpen((value) => !value)} className='flex w-full items-center justify-between px-5 py-4 text-sm font-bold uppercase tracking-[0.14em]'>
        {t('executive.execution.title')}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className='border-t border-border/60'>
          <div className='flex gap-1 p-3'>
            {(['agents', 'tasks', 'map'] as const).map((value) => (
              <button key={value} type='button' onClick={() => setTab(value)} className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', tab === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {t(`executive.execution.${value}`)}
              </button>
            ))}
          </div>
          <div className='h-[520px] min-h-0 border-t border-border/60'>
            {tab === 'agents' ? <div className='h-full overflow-y-auto p-4'><AgentTeamView onOpenTask={onTaskClick} showHeader={false} columns={2} /></div> : null}
            {tab === 'tasks' ? <KanbanBoard streamId={streamId} onTaskClick={onTaskClick} /> : null}
            {tab === 'map' ? <WorkyGraphBoard onTaskClick={onTaskClick} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
