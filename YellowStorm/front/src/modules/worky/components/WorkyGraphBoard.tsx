import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useModuleTranslation } from '@/modules/localization';
import { Controls } from '@/components/ai-elements/controls';
import { useWorkyBoard, useWorkyBoardLoading, useWorkyBoardError } from '../store';
import { layoutCompactCanvasNodes } from '@/modules/playbook/utils/compact-canvas-layout';
import { buildWorkyGraph } from '../worky-graph';
import { WorkyGraphNode } from './WorkyGraphNode';
import type { WorkyTask } from '../types';

interface WorkyGraphBoardProps {
  onTaskClick?: (task: WorkyTask) => void;
}

const NODE_TYPES = { workyStep: WorkyGraphNode };

/**
 * Renders the plan as a dependency graph instead of status columns: one node
 * per step, one edge per `dependsOnStepIds` entry. Dagre lays it out
 * left-to-right by dependency rank, so fan-out/fan-in (parallel steps,
 * joins) is visible directly instead of being flattened into a status lane.
 */
export function WorkyGraphBoard({ onTaskClick }: WorkyGraphBoardProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const board = useWorkyBoard();
  const loading = useWorkyBoardLoading();
  const error = useWorkyBoardError();

  const tasks = useMemo(
    () => (board ? (Object.values(board) as WorkyTask[][]).flat() : []),
    [board],
  );

  const { nodes, edges, taskById } = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const { nodes: rawNodes, edges } = buildWorkyGraph(tasks);
    return { nodes: layoutCompactCanvasNodes(rawNodes, edges), edges, taskById: byId };
  }, [tasks]);

  if (loading && !board) {
    return (
      <div className='flex h-full flex-1 items-center justify-center text-sm text-muted-foreground'>
        {t('kanban.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div className='flex h-full flex-1 items-center justify-center text-sm text-destructive'>
        {t('kanban.error')}
      </div>
    );
  }

  return (
    <div data-testid='worky-graph-board' className='h-full flex-1'>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            const task = taskById.get(node.id);
            if (task) onTaskClick?.(task);
          }}
        >
          <Background bgColor='var(--sidebar)' />
          <Controls position='bottom-left' />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

