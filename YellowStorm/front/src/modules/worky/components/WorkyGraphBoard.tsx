import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useModuleTranslation } from '@/modules/localization';
import { Controls } from '@/components/ai-elements/controls';
import { useWorkyBoard, useWorkyBoardLoading, useWorkyBoardError } from '../store';
import { useStreamAgents } from '../agents/useStreamAgents';
import { layoutCompactCanvasNodes } from '@/modules/playbook/utils/compact-canvas-layout';
import { buildWorkyGraph } from '../worky-graph';
import { WorkyGraphNode } from './WorkyGraphNode';
import { WorkyDependencyEdge } from './WorkyDependencyEdge';
import type { WorkyTask } from '../types';

interface WorkyGraphBoardProps {
  onTaskClick?: (task: WorkyTask) => void;
}

const NODE_TYPES = { workyStep: WorkyGraphNode };
const EDGE_TYPES = { workyDependency: WorkyDependencyEdge };

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

  // Resolve each executor `assigneeKey` to its display name via the same agent
  // roster the agents tab uses, so the graph shows friendly names, not raw keys.
  const { agents } = useStreamAgents();
  const nameByKey = useMemo(() => new Map(agents.map((a) => [a.key, a.name])), [agents]);

  const { nodes, edges, taskById } = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const { nodes: rawNodes, edges: rawEdges } = buildWorkyGraph(tasks);
    const { nodes: laidOut, edges } = layoutCompactCanvasNodes(rawNodes, rawEdges);
    // Enrich each node with its task's timestamp fields (for the "x ago" label)
    // and the resolved executor agent name.
    const nodes = laidOut.map((node) => {
      const task = byId.get(node.id);
      if (!task) return node;
      return {
        ...node,
        data: {
          ...node.data,
          lane: task.lane,
          createdAt: task.createdAt ?? null,
          updatedAt: task.updatedAt ?? null,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          assigneeName: task.assigneeKey ? nameByKey.get(task.assigneeKey) ?? task.assigneeKey : null,
        },
      };
    });
    return { nodes, edges, taskById: byId };
  }, [tasks, nameByKey]);

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
          edgeTypes={EDGE_TYPES}
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

