import { useContext } from 'react';
import { type NodeProps, Handle, Position } from '@xyflow/react';
import { Hand, Trash2, Copy, Pencil } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Node,
  NodeHeader,
  NodeTitle,
  NodeContent,
} from '@/components/ai-elements/node';
import { NodeContextMenuContext } from './PlaybookNode';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { PlaybookNodeData, HumanApprovalConfig, StepStatus } from '../types';

const STATUS_RING: Record<StepStatus, string> = {
  pending: '',
  running: 'border-running shadow-md shadow-running/10',
  completed: '',
  failed: 'ring-2 ring-destructive/60',
  skipped: '',
  interrupted: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
  queued: '',
  pending_approval: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
};

export function HumanApprovalNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData & { humanApprovalConfig?: HumanApprovalConfig };
  const actions = useContext(NodeContextMenuContext);
  const { t } = useModuleTranslation('playbook');
  const config = data.humanApprovalConfig;
  const status = data.stepStatus as StepStatus | undefined;
  const ringClass = status ? STATUS_RING[status] : '';
  const isPending = status === 'interrupted';
  const selectedClass = selected
    ? 'border-2 border-[#ffcd03] ring-4 ring-inset ring-[#ffcd03]/60 shadow-lg shadow-[#ffcd03]/25'
    : '';
  const pendingClass = isPending ? 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10 animate-[pulse_4.5s_ease-in-out_infinite]' : '';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Node
          handles={false}
          className={cn('group min-w-[180px]', ringClass, selectedClass, pendingClass)}
        >
          <Handle
            id="default"
            type="target"
            position={Position.Left}
            className="!w-3 !h-3"
            style={{ background: 'hsl(var(--muted))', border: '2px solid hsl(var(--background))' }}
          />

          <NodeHeader className={isPending ? 'bg-yellow-500/10' : ''}>
            <div className="flex items-center gap-2 w-full">
              <span className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded',
                isPending ? 'bg-yellow-500/15 text-yellow-600' : 'bg-primary/10 text-primary',
              )}>
                <Hand className="h-3 w-3" />
              </span>
              <NodeTitle className="block max-w-[160px] truncate text-sm font-semibold">
                {data.title || t('humanApprovalNode.defaultTitle')}
              </NodeTitle>
            </div>
          </NodeHeader>

          <NodeContent className="p-2.5 space-y-1.5">
            {config?.promptTemplate && (
              <p className="text-xs text-muted-foreground line-clamp-2">{config.promptTemplate}</p>
            )}
            {!config?.promptTemplate && (
              <p className="text-xs text-muted-foreground/60 italic">{t('humanApprovalNode.noPrompt')}</p>
            )}
            {config?.timeoutSeconds != null && config.timeoutSeconds > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {t('humanApprovalNode.timeout', { seconds: config.timeoutSeconds })}
              </p>
            )}

            <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center">
              <Handle
                id="default"
                type="source"
                position={Position.Right}
                className="!w-3 !h-3"
                style={{ background: 'hsl(var(--muted))', border: '2px solid hsl(var(--background))' }}
              />
            </div>
          </NodeContent>

          <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); actions?.onEdit?.(id); }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('nodeContextMenu.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); actions?.onClone?.(id); }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('nodeContextMenu.clone')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); actions?.onDelete?.(id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('nodeContextMenu.delete')}</TooltipContent>
            </Tooltip>
          </div>
        </Node>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={() => actions?.onEdit?.(id)}>
          <Pencil className="h-4 w-4" />
          {t('nodeContextMenu.edit')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions?.onClone?.(id)}>
          <Copy className="h-4 w-4" />
          {t('nodeContextMenu.clone')}
        </ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions?.onDelete?.(id)}>
          <Trash2 className="h-4 w-4" />
          {t('nodeContextMenu.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
