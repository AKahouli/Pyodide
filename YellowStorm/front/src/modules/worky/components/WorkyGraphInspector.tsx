import type { Edge } from '@xyflow/react';
import { X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { StatusBadge } from './StatusBadge';
import { TaskTimestamp } from './TaskTimestamp';
import { traceWorkyDependencies } from '../worky-graph';
import { laneToOrch } from '../status';
import type { WorkyTask } from '../types';

type Focus = 'all' | 'upstream' | 'downstream';

export function WorkyGraphInspector({ task, edges, taskById, hideCompleted, onRevealCompleted, focus, onFocusChange, onSelect, onClose, onOpenTask }: {
  task: WorkyTask;
  edges: Edge[];
  taskById: Map<string, WorkyTask>;
  hideCompleted: boolean;
  onRevealCompleted: () => void;
  focus: Focus;
  onFocusChange: (focus: Focus) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onOpenTask: () => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const directUpstream = edges.filter((edge) => edge.target === task.id).map((edge) => taskById.get(edge.source)).filter((item): item is WorkyTask => Boolean(item));
  const directDownstream = edges.filter((edge) => edge.source === task.id).map((edge) => taskById.get(edge.target)).filter((item): item is WorkyTask => Boolean(item));
  const upstreamCount = traceWorkyDependencies(edges, task.id, 'upstream').size - 1;
  const downstreamCount = traceWorkyDependencies(edges, task.id, 'downstream').size - 1;
  const hiddenPrerequisites = hideCompleted ? [...traceWorkyDependencies(edges, task.id, 'upstream')].filter((id) => id !== task.id && taskById.get(id)?.lane === 'done').length : 0;
  const blocker = task.blockedReason || task.blockerReason;

  return (
    <aside className='flex w-[min(400px,45vw)] shrink-0 flex-col border-l border-border bg-card max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:w-full' aria-label={t('graph.inspector')}>
      <div className='flex items-start justify-between gap-3 border-b border-border p-4'>
        <div className='min-w-0'>
          <h2 className='text-base font-semibold leading-snug'>{task.title}</h2>
          <div className='mt-2 flex flex-wrap items-center gap-2'><StatusBadge status={laneToOrch(task.lane)} /><TaskTimestamp task={task} /></div>
        </div>
        <button type='button' className='rounded-md p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary' onClick={onClose} aria-label={t('taskDetail.close')}><X className='size-4' /></button>
      </div>
      <div className='flex-1 space-y-5 overflow-y-auto p-4 text-sm'>
        {task.assigneeName || task.assigneeKey ? <p><span className='text-muted-foreground'>{t('graph.owner')}: </span>{task.assigneeName || task.assigneeKey}</p> : null}
        {blocker && <section className='rounded-md bg-amber-500/10 p-3'><h3 className='font-semibold'>{t('graph.blocker')}</h3><p className='mt-1 whitespace-pre-wrap'>{blocker}</p></section>}
        <div className='flex flex-wrap gap-2'>
          {(['all', 'upstream', 'downstream'] as const).map((value) => <button type='button' key={value} className={value === focus ? 'rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground' : 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted'} onClick={() => onFocusChange(value)} aria-pressed={value === focus}>{t(`graph.focus.${value}`)}</button>)}
        </div>
        <DependencyList title={t('graph.prerequisites', { count: upstreamCount })} tasks={directUpstream} onSelect={onSelect} />
        {hiddenPrerequisites > 0 && <button type='button' className='text-xs font-medium text-primary underline underline-offset-2' onClick={onRevealCompleted}>{t('graph.hiddenPrerequisites', { count: hiddenPrerequisites })}</button>}
        <DependencyList title={t('graph.unblocks', { count: downstreamCount })} tasks={directDownstream} onSelect={onSelect} />
        {task.description && <details className='rounded-md border border-border p-3'><summary className='cursor-pointer font-semibold'>{t('graph.description')}</summary><p className='mt-2 whitespace-pre-wrap text-muted-foreground'>{task.description}</p></details>}
        {task.result && <details className='rounded-md border border-border p-3'><summary className='cursor-pointer font-semibold'>{t('graph.evidence')}</summary><p className='mt-2 whitespace-pre-wrap text-muted-foreground'>{task.result}</p></details>}
        <button type='button' className='w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground' onClick={onOpenTask}>{t('graph.openTask')}</button>
      </div>
    </aside>
  );
}

function DependencyList({ title, tasks, onSelect }: { title: string; tasks: WorkyTask[]; onSelect: (id: string) => void }): JSX.Element {
  return <section><h3 className='font-semibold'>{title}</h3>{tasks.length ? <ul className='mt-1 space-y-1'>{tasks.map((task) => <li key={task.id}><button type='button' onClick={() => onSelect(task.id)} className='flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary'><span className='font-medium'>{task.title}</span><StatusBadge status={laneToOrch(task.lane)} /></button></li>)}</ul> : <p className='mt-1 text-xs text-muted-foreground'>—</p>}</section>;
}
