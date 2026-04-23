import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Mail } from 'lucide-react';
import {
  Node,
  NodeHeader,
  NodeTitle,
  NodeContent,
} from '@/components/ai-elements/node';
import { PortLabel } from './PortLabel';
import { PORT_COLORS } from '../utils/port-colors';
import type { ArtifactKind } from '../types';

type TriggerPort = {
  id: string;
  name: string;
  artifactKind: ArtifactKind;
};

type TriggerNodeData = {
  title?: string;
  outputPorts?: TriggerPort[];
  triggerType?: 'mail';
};

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

export function PlaybookTriggerNode({ data, selected }: NodeProps) {
  const nodeData = (data || {}) as TriggerNodeData;
  const outputPorts = Array.isArray(nodeData.outputPorts) ? nodeData.outputPorts : [];

  return (
    <Node
      handles={{ target: false, source: false }}
      className={selected ? 'min-w-[220px] border-primary bg-primary/5 ring-2 ring-primary/30' : 'min-w-[220px] border-primary/30 bg-primary/5'}
    >
      <NodeHeader className="bg-primary/10">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <NodeTitle>{nodeData.title || 'Mail Trigger'}</NodeTitle>
        </div>
      </NodeHeader>
      <NodeContent className="relative space-y-3 p-4">
        <div className="text-xs text-muted-foreground">
          Execution-scoped source for the current triggering email only.
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
      </NodeContent>
    </Node>
  );
}
