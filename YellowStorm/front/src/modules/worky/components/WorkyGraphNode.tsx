import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import type { OrchStepStatus } from '../status';

export interface WorkyGraphNodeData {
  title: string;
  status: OrchStepStatus;
  wave: number | null;
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
  const { title, status, wave } = data as unknown as WorkyGraphNodeData;
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
      <StatusBadge status={status} />
    </div>
  );
}
