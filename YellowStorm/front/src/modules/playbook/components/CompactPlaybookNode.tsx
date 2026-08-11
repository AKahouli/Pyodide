import { Bot } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { Badge } from '@/components/ui/badge';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { useModuleTranslation } from '@/modules/localization';
import { useAgentStore } from '@/modules/agent/store';
import { cn } from '@/lib/utils';
import type { PlaybookNodeData, StepStatus } from '../types';

export function CompactPlaybookNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData;
  const { t } = useModuleTranslation('playbook');
  const getAgentById = useAgentStore((s) => s.getAgentById);
  const agent = data.assignedAgentId ? getAgentById(data.assignedAgentId) : null;
  const status = data.stepStatus as StepStatus | undefined;

  return (
    <div
      className={cn(
        'w-[180px] rounded-xl border bg-card/95 px-3 py-2 shadow-sm transition-colors',
        selected ? 'border-[#ffcd03] ring-2 ring-[#ffcd03]/50' : 'border-border',
      )}
    >
      <Handle
        id="compact-target"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        isConnectable={false}
      />
      <Handle
        id="compact-source"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
        isConnectable={false}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold leading-5 text-card-foreground">
            {data.title || t('node.untitled')}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <Bot className="h-3 w-3 shrink-0" />
            <span className={cn('truncate', agent ? 'text-foreground' : 'italic')}>
              {agent?.name || t('node.noAgent')}
            </span>
          </div>
        </div>
        <Badge variant="outline" className="h-5 shrink-0 px-1.5 py-0 text-[10px]">
          {data.executionOrder + 1}
        </Badge>
      </div>
      {status ? (
        <div className="mt-2 flex justify-end">
          <PlaybookStatusBadge status={status} size="xs" />
        </div>
      ) : null}
    </div>
  );
}
