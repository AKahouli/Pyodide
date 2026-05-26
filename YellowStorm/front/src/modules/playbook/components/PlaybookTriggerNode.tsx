import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Mail, Trash2, Power, Pencil } from 'lucide-react';
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
import { PortLabel } from './PortLabel';
import { PORT_COLORS } from '../utils/port-colors';
import { useModuleTranslation } from '@/modules/localization';
import type { ArtifactKind } from '../types';
import type { TriggerNodeActions } from '../hooks/usePlaybookCanvas';

type TriggerPort = {
  id: string;
  name: string;
  artifactKind: ArtifactKind;
};

type TriggerNodeData = {
  title?: string;
  outputPorts?: TriggerPort[];
  triggerType?: 'mail';
  enabled?: boolean;
  triggerActions?: TriggerNodeActions;
  playbookId?: string;
};

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

export function PlaybookTriggerNode({ data: rawData, selected }: NodeProps) {
  const data = (rawData || {}) as TriggerNodeData;
  const outputPorts = Array.isArray(data.outputPorts) ? data.outputPorts : [];
  const actions = data.triggerActions;
  const isEnabled = data.enabled !== false;
  const playbookId = data.playbookId;
  const { t } = useModuleTranslation('playbook');

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Node
          handles={{ target: false, source: false }}
          className={selected ? 'min-w-[220px] border-primary bg-primary/5 ring-2 ring-primary/30' : 'min-w-[220px] border-primary/30 bg-primary/5'}
        >
          <NodeHeader className="bg-primary/10">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <NodeTitle>{data.title || 'Mail Trigger'}</NodeTitle>
            </div>
          </NodeHeader>
          <NodeContent className="relative space-y-3 p-4">
            <div className="text-xs text-muted-foreground">
              {t('triggerNode.description')}
            </div>
            <div className="relative min-h-[88px]">
              {outputPorts.map((port, idx) => {
                const top = `${getPortTopPercent(idx, outputPorts.length)}%`;
                const colors = PORT_COLORS[port.artifactKind];
                return (
                  <div
                    key={port.id}
                    className="absolute inset-x-0"
                    style={{ top, transform: 'translateY(-50%)' }}
                  >
                    <Handle
                      id={port.id}
                      type="source"
                      position={Position.Right}
                      className="!h-3 !w-3"
                      style={{
                        background: colors?.raw || 'hsl(var(--muted))',
                        border: '2px solid hsl(var(--background))',
                        top: 0,
                      }}
                    />
                    <div className="pr-6">
                      <PortLabel
                        name={port.name}
                        kind={port.artifactKind}
                        position="right"
                        selected={selected}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-1 pt-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions?.onEdit();
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('triggerNode.edit')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    disabled={!playbookId}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (playbookId) {
                        void actions?.onToggleEnabled(playbookId, isEnabled);
                      }
                    }}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isEnabled ? t('triggerNode.disable') : t('triggerNode.enable')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={!playbookId}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (playbookId) {
                        void actions?.onDelete(playbookId);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('triggerNode.delete')}</TooltipContent>
              </Tooltip>
            </div>
          </NodeContent>
        </Node>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={() => actions?.onEdit()}>
          <Pencil className="h-4 w-4" />
          {t('triggerNode.edit')}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!playbookId}
          onClick={() => {
            if (playbookId) {
              void actions?.onToggleEnabled(playbookId, isEnabled);
            }
          }}
        >
          <Power className="h-4 w-4" />
          {isEnabled ? t('triggerNode.disable') : t('triggerNode.enable')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          disabled={!playbookId}
          onClick={() => {
            if (playbookId) {
              void actions?.onDelete(playbookId);
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
          {t('triggerNode.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
