import { useEffect, useContext } from 'react';
import { type NodeProps, Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { GitBranch, Trash2, Copy, Pencil, AlertTriangle, Scissors, ClipboardPaste } from 'lucide-react';
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
import type { ArtifactKind, PlaybookNodeData, RouterConfig, StepStatus, TaskInputPort, TaskOutputPort } from '../types';

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

function getSummaryCountKey(count: number, singularKey: string, pluralKey: string): string {
  return count === 1 ? singularKey : pluralKey;
}

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

function getHandleStyle(kind: ArtifactKind): React.CSSProperties {
  const colors = PORT_COLORS[kind];
  return {
    background: colors?.raw || 'hsl(var(--muted))',
    border: '2px solid hsl(var(--background))',
  };
}

export function RouterNode({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as PlaybookNodeData & { routerConfig?: RouterConfig };
  const actions = useContext(NodeContextMenuContext);
  const { t } = useModuleTranslation('playbook');
  const routerConfig = data.routerConfig ?? DEFAULT_ROUTER_CONFIG;
  const outputLabels = routerConfig.outputLabels ?? DEFAULT_ROUTER_CONFIG.outputLabels;
  const nonErrorLabels = outputLabels.filter((label) => label !== '__error__');
  const inputPorts: TaskInputPort[] = data.inputPorts?.length
    ? data.inputPorts
    : [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }];
  const outputPorts: TaskOutputPort[] = data.outputPorts?.length
    ? data.outputPorts
    : outputLabels.map((label) => ({ id: label, name: label, artifactKind: 'text' }));
  const maxIterations = routerConfig.maxIterations ?? 0;
  const deterministicConditions = routerConfig.conditions?.length ?? 0;
  const defaultLabel = routerConfig.defaultLabel;
  const status = data.stepStatus as StepStatus | undefined;
  const ringClass = status ? STATUS_RING[status] : '';
  const selectedClass = selected
    ? 'border-2 border-[#ffcd03] ring-4 ring-inset ring-[#ffcd03]/60 shadow-lg shadow-[#ffcd03]/25'
    : '';
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, inputPorts.length, outputPorts.length, updateNodeInternals]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Node
          handles={false}
          className={cn('group min-w-[180px]', ringClass, selectedClass)}
        >
          <div className="absolute left-0 inset-y-0 z-10 w-0 pointer-events-none">
            {inputPorts.map((port, idx) => (
              <div
                key={port.id}
                className="absolute left-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
                style={{ top: `${getPortTopPercent(idx, inputPorts.length)}%` }}
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
            {outputPorts.map((port, idx) => {
              const top = `${getPortTopPercent(idx, outputPorts.length)}%`;
              const isError = port.id === '__error__';
              return (
                <div
                  key={port.id}
                  className="absolute right-0 z-10 flex items-center -translate-y-1/2 pointer-events-auto"
                  style={{ top }}
                >
                  <Handle
                    id={port.id}
                    type="source"
                    position={Position.Right}
                    className="!w-3 !h-3"
                    style={{ ...getHandleStyle(port.artifactKind), top: 0 }}
                  />
                  <div className="relative">
                    <PortLabel name={port.name} kind={port.artifactKind} position="right" selected={selected} />
                    {isError ? (
                      <AlertTriangle className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 rounded-full bg-background text-destructive" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

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
            <div className="space-y-1 text-[10px] text-muted-foreground">
              <p>
                {t(
                  getSummaryCountKey(nonErrorLabels.length, 'routerNode.routesConfigured.one', 'routerNode.routesConfigured.other'),
                  { count: nonErrorLabels.length },
                )}
              </p>
              <p>
                {deterministicConditions > 0
                  ? t(
                    getSummaryCountKey(deterministicConditions, 'routerNode.rulesConfigured.one', 'routerNode.rulesConfigured.other'),
                    { count: deterministicConditions },
                  )
                  : t('routerNode.legacyRouting')}
              </p>
              {defaultLabel ? (
                <p>{t('routerNode.defaultRoute', { label: defaultLabel })}</p>
              ) : null}
              {maxIterations > 0 ? (
                <p>{t('routerNode.loopLimit', { count: maxIterations })}</p>
              ) : null}
            </div>

            {data.activeRouterLabel && (
              <div className="flex items-center gap-1 rounded bg-green-500/10 border border-green-500/30 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                <GitBranch className="h-2.5 w-2.5" />
                {data.activeRouterLabel}
              </div>
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
