import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { TaskTimestamp } from './TaskTimestamp';
import type { OrchStepStatus } from '../status';
import type { WorkyBoardLane } from '../types';

export interface WorkyGraphNodeData {
  title: string;
  status: OrchStepStatus;
  wave: number | null;
  // Enriched by WorkyGraphBoard from the underlying task.
  lane?: WorkyBoardLane;
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Resolved display name of the executor agent handling this task, if any. */
  assigneeName?: string | null;
  [key: string]: unknown;
}

const STATUS_BORDER: Record<OrchStepStatus, string> = {
  pending: 'border-border/60',
  running: 'border-primary',
  blocked: 'border-amber-500/70',
  completed: 'border-green-600/60',
  failed: 'border-destructive/70',
};

export function WorkyGraphNode({ data }: NodeProps): JSX.Element {
  const { title, status, wave, lane, createdAt, updatedAt, startedAt, completedAt, assigneeName } = data as unknown as WorkyGraphNodeData;
  const { t } = useModuleTranslation('worky');
  return (
    <div
      className={cn(
        'w-[220px] rounded-md border-2 bg-background/95 px-3 py-2 shadow-sm',
        STATUS_BORDER[status],
      )}
    >
      <Handle type='target' position={Position.Left} className='!h-2 !w-2' />
      <Handle type='source' position={Position.Right} className='!h-2 !w-2' />
      <div className='mb-1 flex items-start justify-between gap-2'>
        <h3 className='line-clamp-2 text-xs font-medium leading-snug'>{title}</h3>
        {wave !== null ? (
          <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
            {t('kanban.graph.wave', { n: wave })}
          </span>
        ) : null}
      </div>
      {assigneeName ? (
        <div className='mb-1 flex items-center gap-1 text-[10px] text-muted-foreground' title={assigneeName}>
          <User className='h-3 w-3 shrink-0' aria-hidden />
          <span className='truncate'>{assigneeName}</span>
        </div>
      ) : null}
      <div className='flex items-center justify-between gap-2'>
        <StatusBadge status={status} />
        {lane ? (
          <TaskTimestamp task={{ lane, createdAt, updatedAt, startedAt: startedAt ?? null, completedAt: completedAt ?? null }} />
        ) : null}
      </div>
    </div>
  );
}
