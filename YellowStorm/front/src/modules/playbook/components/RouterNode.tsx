import { useEffect, useContext } from 'react';
import { type NodeProps, Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { GitBranch, Trash2, Copy, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react';
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
import type { PlaybookNodeData, RouterConfig, StepStatus } from '../types';

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

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  outputLabels: ['retry', 'done', '__error__'],
  maxIterations: 3,
};

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

function getHandleStyle(isError: boolean): React.CSSProperties {
  return {
    background: isError ? 'var(--destructive)' : 'hsl(var(--primary))',
    border: '2px solid hsl(var(--background))',
  };
}

export function RouterNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData & { routerConfig?: RouterConfig };
  const actions = useContext(NodeContextMenuContext);
  const { t } = useModuleTranslation('playbook');
  const routerConfig = data.routerConfig ?? DEFAULT_ROUTER_CONFIG;
  const outputLabels = routerConfig.outputLabels ?? DEFAULT_ROUTER_CONFIG.outputLabels;
  const maxIterations = routerConfig.maxIterations ?? 0;
  const deterministicConditions = routerConfig.conditions?.length ?? 0;
  const status = data.stepStatus as StepStatus | undefined;
  const ringClass = status ? STATUS_RING[status] : '';
  const selectedClass = selected
    ? 'border-2 border-[#ffcd03] ring-4 ring-inset ring-[#ffcd03]/60 shadow-lg shadow-[#ffcd03]/25'
    : '';
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputLabels.length, updateNodeInternals]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Node
          handles={false}
          className={cn('group min-w-[180px]', ringClass, selectedClass)}
        >
          <Handle
            id="default"
            type="target"
            position={Position.Left}
            className="!w-3 !h-3"
            style={{ background: 'hsl(var(--muted))', border: '2px solid hsl(var(--background))' }}
          />

          <NodeHeader>
            <div className="flex items-center gap-2 w-full">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <GitBranch className="h-3 w-3" />
              </span>
              <NodeTitle className="block max-w-[160px] truncate text-sm font-semibold">
                {data.title || t('routerNode.defaultTitle')}
              </NodeTitle>
            </div>
          </NodeHeader>

          <NodeContent className="p-2.5 space-y-1.5">
            {data.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{data.description}</p>
            )}
            {maxIterations > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {t('routerNode.maxIterations', { count: maxIterations })}
              </p>
            )}
            {deterministicConditions > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {t('routerNode.conditionsConfigured', { count: deterministicConditions })}
              </p>
            )}

            {data.activeRouterLabel && (
              <div className="flex items-center gap-1 rounded bg-green-500/10 border border-green-500/30 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                <GitBranch className="h-2.5 w-2.5" />
                {data.activeRouterLabel}
              </div>
            )}

            <div className="space-y-0.5 pt-1">
              {outputLabels.map((label, idx) => {
                const isError = label === '__error__';
                const isDone = label === 'done';
                const top = `${getPortTopPercent(idx, outputLabels.length)}%`;
                return (
                  <div
                    key={label}
                    className="absolute right-0 z-10 flex -translate-y-1/2 items-center gap-1.5"
                    style={{ top }}
                  >
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium nodrag nopan',
                        isError
                          ? 'bg-destructive/10 text-destructive border border-destructive/30'
                          : isDone
                            ? 'bg-green-500/10 text-green-600 border border-green-500/30'
                            : 'bg-primary/10 text-primary border border-primary/30',
                      )}
                    >
                      {isError && <AlertTriangle className="mr-0.5 h-2.5 w-2.5 inline" />}
                      {isDone && <CheckCircle2 className="mr-0.5 h-2.5 w-2.5 inline" />}
                      {label}
                    </span>
                    <Handle
                      id={label}
                      type="source"
                      position={Position.Right}
                      className="!w-3 !h-3"
                      style={getHandleStyle(isError)}
                    />
                  </div>
                );
              })}
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
