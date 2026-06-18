import { useModuleTranslation } from '@/modules/localization';
import { useTaskOps } from '../query/hooks';
import type { WorkyTask } from '../types';

interface TaskDetailDrawerProps {
  streamId: string;
  task: WorkyTask | null;
  onClose: () => void;
}

const ROLE_LABEL_KEYS: Record<string, string> = {
  ephemeral_ai_agent: 'kanban.assignees.ephemeral_ai_agent',
  human_agent: 'kanban.assignees.human_agent',
  unassigned: 'kanban.assignees.unassigned',
};

/**
 * Task detail drawer. Part 3 surfaces per-task controls (move,
 * pause, resume, cancel, review) and shows trace/cost placeholders
 * (Part 4 wires the real trace/cost surfaces). Raw payloads are
 * admin-only per canonical §9 — for Part 3 the drawer is the
 * owner view; the admin view is a future hardening step.
 */
export function TaskDetailDrawer({
  streamId,
  task,
  onClose,
}: TaskDetailDrawerProps): JSX.Element | null {
  const { t: tWorky } = useModuleTranslation('worky');
  const ops = useTaskOps(streamId);

  if (!task) return null;

  return (
    <div
      className='fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card shadow-lg'
      role='dialog'
      aria-label={tWorky('taskDetail.title')}
      data-testid='task-detail-drawer'
    >
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <h2 className='truncate text-sm font-semibold'>{tWorky('taskDetail.title')}: {task.title}</h2>
        <button
          type='button'
          onClick={onClose}
          className='text-xs text-muted-foreground'
          aria-label={tWorky('taskDetail.close')}
        >
          ✕
        </button>
      </div>
      <div className='flex-1 overflow-y-auto px-4 py-3 text-sm'>
        <p className='mb-3 whitespace-pre-wrap text-muted-foreground'>{task.description}</p>
        <dl className='grid grid-cols-2 gap-2 text-xs'>
          <dt className='font-medium'>{tWorky('taskDetail.lane')}</dt>
          <dd>{task.lane}</dd>
          <dt className='font-medium'>{tWorky('taskDetail.executionState')}</dt>
          <dd>{task.executionState}</dd>
          <dt className='font-medium'>{tWorky('taskDetail.priority')}</dt>
          <dd>{tWorky(`kanban.priorities.${task.priority}`)}</dd>
          <dt className='font-medium'>{tWorky('taskDetail.assignee')}</dt>
          <dd>
            {ROLE_LABEL_KEYS[task.assigneeType]
              ? tWorky(ROLE_LABEL_KEYS[task.assigneeType] as 'kanban.assignees.ephemeral_ai_agent' | 'kanban.assignees.human_agent' | 'kanban.assignees.unassigned')
              : task.assigneeType}
          </dd>
          <dt className='font-medium'>{tWorky('taskDetail.actionCategory')}</dt>
          <dd>{task.actionCategory}</dd>
        </dl>
        {task.dependsOn.length > 0 ? (
          <div className='mt-4'>
            <h3 className='text-xs font-semibold'>{tWorky('taskDetail.dependsOn')}</h3>
            <ul className='mt-1 list-inside list-disc text-xs text-muted-foreground'>
              {task.dependsOn.map((dep) => (
                <li key={dep}>{dep}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {task.blockerReason ? (
          <div className='mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700'>
            {tWorky('taskDetail.blocker', { reason: task.blockerReason })}
          </div>
        ) : null}
        <div className='mt-6 border-t border-border pt-4'>
          <h3 className='text-xs font-semibold text-muted-foreground'>
            {tWorky('taskDetail.traces_placeholder')}
          </h3>
          <p className='mt-1 text-xs text-muted-foreground'>
            {tWorky('taskDetail.cost_placeholder')}
          </p>
        </div>
      </div>
      <div className='flex flex-wrap gap-2 border-t border-border px-4 py-3'>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-2 py-1 text-xs'
          onClick={() => ops.move.mutate({ taskId: task.id, lane: 'ready' })}
          disabled={ops.move.isPending}
        >
          {tWorky('taskDetail.moveReady')}
        </button>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-2 py-1 text-xs'
          onClick={() => ops.pause.mutate({ taskId: task.id })}
          disabled={ops.pause.isPending}
        >
          {tWorky('taskDetail.pause')}
        </button>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-2 py-1 text-xs'
          onClick={() => ops.resume.mutate({ taskId: task.id })}
          disabled={ops.resume.isPending}
        >
          {tWorky('taskDetail.resume')}
        </button>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-2 py-1 text-xs'
          onClick={() => ops.review.mutate({ taskId: task.id })}
          disabled={ops.review.isPending}
        >
          {tWorky('taskDetail.review')}
        </button>
        <button
          type='button'
          className='ml-auto rounded-md border border-destructive/40 bg-background px-2 py-1 text-xs text-destructive'
          onClick={() => ops.cancel.mutate({ taskId: task.id })}
          disabled={ops.cancel.isPending}
        >
          {tWorky('taskDetail.cancel')}
        </button>
      </div>
    </div>
  );
}
