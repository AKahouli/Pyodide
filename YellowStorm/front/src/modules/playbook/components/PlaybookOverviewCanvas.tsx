import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';

import { Canvas } from '@/components/ai-elements/canvas';
import { Controls } from '@/components/ai-elements/controls';
import { useModuleTranslation } from '@/modules/localization';
import { OverviewControlEdge } from './OverviewControlEdge';
import { OverviewPlaybookNode } from './OverviewPlaybookNode';
import {
  getOverviewFocusIds,
  layoutOverviewGraph,
  projectOverviewGraph,
  type OverviewEdge,
  type OverviewGraph,
  type OverviewNode,
} from '../utils/overview-canvas';

interface PlaybookOverviewCanvasProps {
  nodes: Node[];
  edges: Edge[];
  resultNodeIds: ReadonlySet<string>;
  executableNodeIds: ReadonlySet<string>;
  executionDisabled: boolean;
  onOpenNode: (nodeId: string) => void;
  onOpenExecution: (nodeId: string) => void;
  onExecuteNode: (nodeId: string) => void;
}

const nodeTypes = { playbookOverview: OverviewPlaybookNode };
const edgeTypes = { overviewControl: OverviewControlEdge };

function applyFocus(graph: OverviewGraph, selectedNodeId: string | null): OverviewGraph {
  const focusedIds = getOverviewFocusIds(graph.edges, selectedNodeId);
  if (!focusedIds) return graph;
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: { ...node.data, dimmed: !focusedIds.has(node.id) },
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data!, dimmed: !focusedIds.has(edge.source) || !focusedIds.has(edge.target) },
    })),
  };
}

const EXECUTION_OPEN_DELAY_MS = 220;

function PlaybookOverviewFlow({
  nodes,
  edges,
  resultNodeIds,
  executableNodeIds,
  executionDisabled,
  onOpenNode,
  onOpenExecution,
  onExecuteNode,
}: PlaybookOverviewCanvasProps) {
  const { t } = useModuleTranslation('playbook');
  const reactFlow = useReactFlow<OverviewNode, OverviewEdge>();
  const projectedGraph = useMemo(() => projectOverviewGraph(nodes, edges), [nodes, edges]);
  const layoutKey = JSON.stringify([
    projectedGraph.nodes.map((node) => node.id),
    projectedGraph.edges.map((edge) => [edge.id, edge.source, edge.target]),
  ]);
  const projectedGraphRef = useRef(projectedGraph);
  projectedGraphRef.current = projectedGraph;
  const [layout, setLayout] = useState({ key: layoutKey, graph: projectedGraph });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const layoutRequestRef = useRef(0);
  const executionOpenTimerRef = useRef<number | null>(null);

  const clearExecutionOpenTimer = useCallback(() => {
    if (executionOpenTimerRef.current === null) return;
    window.clearTimeout(executionOpenTimerRef.current);
    executionOpenTimerRef.current = null;
  }, []);

  useEffect(() => {
    const requestId = ++layoutRequestRef.current;
    const graph = projectedGraphRef.current;
    setLayout({ key: layoutKey, graph });
    let disposed = false;
    void import('elkjs/lib/elk.bundled.js')
      .then(({ default: ELK }) => layoutOverviewGraph(graph, new ELK()))
      .then((nextGraph) => {
        if (disposed || requestId !== layoutRequestRef.current) return;
        setLayout({ key: layoutKey, graph: nextGraph });
        window.requestAnimationFrame(() => {
          void reactFlow.fitView({ padding: 0.16, duration: 300 });
        });
      })
      .catch(() => {
        if (disposed || requestId !== layoutRequestRef.current) return;
        window.requestAnimationFrame(() => {
          void reactFlow.fitView({ padding: 0.16, duration: 200 });
        });
      });
    return () => {
      disposed = true;
    };
  }, [layoutKey, reactFlow]);

  const layoutGraph = useMemo(() => {
    if (layout.key !== layoutKey) return projectedGraph;
    const positions = new Map(layout.graph.nodes.map((node) => [node.id, node.position]));
    const routes = new Map(layout.graph.edges.map((edge) => [edge.id, edge.data?.routePoints]));
    return {
      nodes: projectedGraph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
      edges: projectedGraph.edges.map((edge) => ({
        ...edge,
        data: { ...edge.data!, routePoints: routes.get(edge.id) },
      })),
    };
  }, [layout, layoutKey, projectedGraph]);

  useEffect(() => {
    if (selectedNodeId && !layoutGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [layoutGraph.nodes, selectedNodeId]);

  useEffect(() => () => clearExecutionOpenTimer(), [clearExecutionOpenTimer]);

  const visibleGraph = useMemo(
    () => applyFocus(layoutGraph, selectedNodeId),
    [layoutGraph, selectedNodeId],
  );
  const interactiveNodes = useMemo(() => visibleGraph.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      canExecute: executableNodeIds.has(node.id),
      executionDisabled,
      onExecute: onExecuteNode,
    },
  })), [executionDisabled, executableNodeIds, onExecuteNode, visibleGraph.nodes]);

  return (
    <div className="absolute inset-0" aria-label={t('canvas.overview.ariaLabel')}>
      <Canvas
        nodes={interactiveNodes}
        edges={visibleGraph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        selectionOnDrag={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        onNodeClick={(_, node) => {
          clearExecutionOpenTimer();
          setSelectedNodeId(node.id);
          if (resultNodeIds.has(node.id)) {
            executionOpenTimerRef.current = window.setTimeout(() => {
              executionOpenTimerRef.current = null;
              onOpenExecution(node.id);
            }, EXECUTION_OPEN_DELAY_MS);
          }
        }}
        onNodeDoubleClick={(_, node) => {
          clearExecutionOpenTimer();
          onOpenNode(node.id);
        }}
        onPaneClick={() => {
          clearExecutionOpenTimer();
          setSelectedNodeId(null);
        }}
      >
        <Controls position="bottom-left" />
      </Canvas>
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        {t('canvas.overview.hint')}
      </div>
    </div>
  );
}

export function PlaybookOverviewCanvas(props: PlaybookOverviewCanvasProps) {
  return (
    <ReactFlowProvider>
      <PlaybookOverviewFlow {...props} />
    </ReactFlowProvider>
  );
}
