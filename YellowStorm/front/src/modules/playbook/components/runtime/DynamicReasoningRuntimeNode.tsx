import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { StepStatus } from '../../types';
import { PlaybookStatusBadge } from '../PlaybookStatusBadge';

interface RuntimeNodeData extends Record<string, unknown> {
  title: string;
  status: StepStatus;
}

export function DynamicReasoningRuntimeNode({ data, selected }: NodeProps) {
  const value = data as RuntimeNodeData;
  return (
    <div className={cn('w-64 rounded-xl border bg-card px-4 py-3 shadow-sm', selected && 'ring-2 ring-primary', value.status === 'running' && 'border-indigo-500')}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="min-w-0 flex-1 truncate rounded-sm text-[11px] font-semibold leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              tabIndex={0}
            >
              {value.title}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-80 text-pretty">
            {value.title}
          </TooltipContent>
        </Tooltip>
        <PlaybookStatusBadge status={value.status} size="xs" />
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-muted-foreground" />
    </div>
  );
}
