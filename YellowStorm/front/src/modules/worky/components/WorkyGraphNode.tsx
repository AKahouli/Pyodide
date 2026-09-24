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
  compact?: boolean;
  dimmed?: boolean;
  isSelected?: boolean;
  hiddenPrerequisites?: number;
  [key: string]: unknown;
}

const STATUS_BORDER: Record<OrchStepStatus, string> = {
  pending: 'border-border/60',
  running: 'border-primary',
  blocked: 'border-amber-500/70',
  completed: 'border-green-600/60',
  failed: 'border-destructive/70',
  canceled: 'border-muted-foreground/50',
};

export function WorkyGraphNode({ data }: NodeProps): JSX.Element {
  const { title, status, lane, createdAt, updatedAt, startedAt, completedAt, assigneeName, compact, dimmed, isSelected, hiddenPrerequisites } = data as unknown as WorkyGraphNodeData;
  const { t } = useModuleTranslation('worky');
  return (
    <div
      className={cn(
        'box-border h-[104px] w-[260px] overflow-hidden rounded-xl border-2 bg-background px-3 py-2 shadow-sm transition-opacity',
        STATUS_BORDER[status],
        dimmed && 'opacity-35',
        isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <Handle type='target' position={Position.Left} className='!h-2 !w-2' />
      <Handle type='source' position={Position.Right} className='!h-2 !w-2' />
      <h3 className='line-clamp-2 min-h-8 text-xs font-semibold leading-snug' title={title}>{title}</h3>
      {!compact && assigneeName ? (
        <div className='mb-1 flex items-center gap-1 text-[11px] text-muted-foreground' title={assigneeName}>
          <User className='h-3 w-3 shrink-0' aria-hidden />
          <span className='truncate'>{assigneeName}</span>
        </div>
      ) : null}
      <div className='mt-1 flex items-center justify-between gap-2'>
        <StatusBadge status={status} />
        {hiddenPrerequisites ? <span className='text-[10px] font-medium text-amber-500' title={t('graph.hiddenPrerequisites', { count: hiddenPrerequisites })}>{t('graph.hiddenCount', { count: hiddenPrerequisites })}</span> : !compact && lane ? (
          <TaskTimestamp task={{ lane, createdAt, updatedAt, startedAt: startedAt ?? null, completedAt: completedAt ?? null }} />
        ) : null}
      </div>
    </div>
  );
}
