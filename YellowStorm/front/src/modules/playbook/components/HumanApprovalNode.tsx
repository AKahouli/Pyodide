import { useContext, useEffect } from 'react';
import { type NodeProps, Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { Hand, Trash2, Copy, Pencil, Scissors, ClipboardPaste } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { PortLabel } from './PortLabel';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import { PORT_COLORS } from '../utils/port-colors';
import type { ArtifactKind, PlaybookNodeData, HumanApprovalConfig, StepStatus, TaskInputPort, TaskOutputPort } from '../types';

const STATUS_RING: Record<StepStatus, string> = {
  pending: '',
  running: 'border-running shadow-md shadow-running/10',
  completed: '',
  cancelled: 'ring-2 ring-destructive/60',
  failed: 'ring-2 ring-destructive/60',
  skipped: '',
  interrupted: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
  queued: '',
  pending_approval: 'ring-2 ring-yellow-500/60 shadow-md shadow-yellow-500/10',
};

function getPortTopPercent(index: number, total: number): number {
  if (total <= 1) return 50;
  return (100 / (total + 1)) * (index + 1);
}

function getHandleStyle(kind: ArtifactKind): React.CSSProperties {
  const colors = PORT_COLORS[kind];
  return {
    background: colors?.raw || 'hsl(var(--muted))',
    border: '2px solid hsl(var(--background))',
  };
}

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
  const inputPorts: TaskInputPort[] = data.inputPorts?.length
    ? data.inputPorts
    : [{ id: 'default', name: t('nodeEditor.portDefaultInput'), artifactKind: 'text', required: false }];
  const outputPorts: TaskOutputPort[] = data.outputPorts?.length
    ? data.outputPorts
    : [{ id: 'default', name: t('nodeEditor.portDefaultOutput'), artifactKind: 'text' }];
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputPorts.length, outputPorts.length, updateNodeInternals]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Node
          handles={false}
          className={cn('group min-w-[180px]', ringClass, selectedClass, pendingClass)}
        >
          <div className="absolute left-0 inset-y-0 z-10 w-0 pointer-events-none">
            {inputPorts.map((port, index) => (
              <div
                key={port.id}
                className="absolute left-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
                style={{ top: `${getPortTopPercent(index, inputPorts.length)}%` }}
              >
                <PortLabel name={port.name} kind={port.artifactKind} position="left" selected={selected} />
                <Handle
                  id={port.id}
                  type="target"
                  position={Position.Left}
                  className="!w-3 !h-3"
                  style={{ ...getHandleStyle(port.artifactKind), top: 0 }}
                />
              </div>
            ))}
          </div>

          <div className="absolute right-0 inset-y-0 z-10 w-0 pointer-events-none">
            {outputPorts.map((port, index) => (
              <div
                key={port.id}
                className="absolute right-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
                style={{ top: `${getPortTopPercent(index, outputPorts.length)}%` }}
              >
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Right}
                  className="!w-3 !h-3"
                  style={{ ...getHandleStyle(port.artifactKind), top: 0 }}
                />
                <PortLabel name={port.name} kind={port.artifactKind} position="right" selected={selected} />
              </div>
            ))}
          </div>

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
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!actions?.hasSelection} onClick={() => actions?.onCopySelection?.()}>
          <Copy className="h-4 w-4" />
          {t('clipboard.menuCopy')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions?.hasSelection} onClick={() => actions?.onCutSelection?.()}>
          <Scissors className="h-4 w-4" />
          {t('clipboard.menuCut')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions?.onPasteClipboard?.()}>
          <ClipboardPaste className="h-4 w-4" />
          {t('clipboard.menuPaste')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => actions?.onDelete?.(id)}>
          <Trash2 className="h-4 w-4" />
          {t('nodeContextMenu.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
