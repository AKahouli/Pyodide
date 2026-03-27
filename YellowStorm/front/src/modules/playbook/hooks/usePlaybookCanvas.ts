/**
 * Playbook Canvas Hook
 * Bridges ReactFlow state with Zustand store
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type OnNodeDrag,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { usePlaybookStore, useCurrentPlaybook } from '../store';
import type { PlaybookTask, PlaybookEdge, PlaybookNodeData } from '../types';

export function tasksToNodes(tasks: PlaybookTask[]): Node[] {
  return tasks.map((task) => ({
    id: task.id,
    type: 'playbookStep',
    position: { x: task.positionX, y: task.positionY },
    data: { ...task } as PlaybookNodeData,
  }));
}

function nodesToTasks(nodes: Node[]): PlaybookTask[] {
  return nodes.map((node) => {
    const data = node.data as PlaybookNodeData;
    return {
      ...data,
      id: node.id,
      positionX: node.position.x,
      positionY: node.position.y,
    };
  });
}

function playbookEdgesToFlowEdges(edges: PlaybookEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: 'animated',
  }));
}

function flowEdgesToPlaybookEdges(edges: Edge[]): PlaybookEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.source,
    targetId: edge.target,
  }));
}

/** Returns true if adding an edge from source→target would create a cycle. */
function wouldCreateCycle(
  edges: Edge[],
  source: string,
  target: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const children = adjacency.get(edge.source) ?? [];
    children.push(edge.target);
    adjacency.set(edge.source, children);
  }

  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      queue.push(neighbor);
    }
  }
  return false;
}

/**
 * Defers a store update to the next macrotask so it doesn't run
 * inside a React setState updater (which causes infinite update loops).
 */
function deferStoreUpdate(fn: () => void) {
  setTimeout(fn, 0);
}

export function usePlaybookCanvas() {
  const playbook = useCurrentPlaybook();
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Keep a ref to the latest nodes so we can read them outside setState updaters
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  // Track which playbook snapshot we've synced to avoid re-syncing on every store update
  const syncedKeyRef = useRef<string | null>(null);

  // Sync ReactFlow state when playbook is loaded/changed from the API
  useEffect(() => {
    if (!playbook) {
      syncedKeyRef.current = null;
      return;
    }

    // Sync when playbook ID changes (navigation) or updatedAt changes (design/revert)
    const syncKey = `${playbook.id}::${playbook.updatedAt}`;
    if (syncedKeyRef.current !== syncKey) {
      syncedKeyRef.current = syncKey;
      setNodes(tasksToNodes(playbook.tasks));
      setEdges(playbookEdgesToFlowEdges(playbook.edges));
    }
  }, [playbook]);

  // Keep node metadata in sync when task data changes locally in the store
  // without a server-backed updatedAt change, e.g. after saving/activating
  // a replay baseline. This preserves current ReactFlow position/selection.
  useEffect(() => {
    if (!playbook) return;

    const taskMap = new Map(playbook.tasks.map((task) => [task.id, task]));
    setNodes((nds) => {
      let changed = false;
      const updated = nds.map((node) => {
        const task = taskMap.get(node.id);
        if (!task) return node;

        const currentData = node.data as PlaybookNodeData;
        const nextData = { ...currentData, ...task } as PlaybookNodeData;
        if (JSON.stringify(currentData) === JSON.stringify(nextData)) {
          return node;
        }

        changed = true;
        return { ...node, data: nextData };
      });

      return changed ? updated : nds;
    });
  }, [playbook?.tasks]);

  // Node position changes: just update local ReactFlow state (no store sync).
  // Store sync happens in onNodeDragStop.
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  // Sync positions to store only when drag ends.
  // Reads from nodesRef instead of setState updater to avoid nested updates.
  const onNodeDragStop: OnNodeDrag = useCallback(
    () => {
      updateTasks(nodesToTasks(nodesRef.current));
    },
    [updateTasks],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // Selection-only changes are UI-local and should not trigger a store
      // update / autosave, otherwise the API response replaces the local
      // ReactFlow state and the selection is lost (preventing edge deletion).
      const hasStructuralChange = changes.some(
        (c) => c.type !== 'select',
      );

      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        if (hasStructuralChange) {
          deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
        }
        return updated;
      });
    },
    [updateEdges],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        if (wouldCreateCycle(eds, connection.source, connection.target)) {
          return eds;
        }

        const newEdge: Edge = {
          ...connection,
          id: `e-${connection.source}-${connection.target}`,
          type: 'animated',
        };
        const updated = addEdge(newEdge, eds) as Edge[];
        deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
        return updated;
      });
    },
    [updateEdges],
  );

  const addNode = useCallback(
    (task: PlaybookTask) => {
      const newNode: Node = {
        id: task.id,
        type: 'playbookStep',
        position: { x: task.positionX, y: task.positionY },
        data: { ...task } as PlaybookNodeData,
      };
      setNodes((nds) => {
        const updated = [...nds, newNode];
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
    },
    [updateTasks],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.filter((n) => n.id !== nodeId);
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
      setEdges((eds) => {
        const updated = eds.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        );
        deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
        return updated;
      });
    },
    [updateTasks, updateEdges],
  );

  const updateNodeData = useCallback(
    (nodeId: string, data: Partial<PlaybookTask>) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
        );
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
    },
    [updateTasks],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onNodeDragStop,
    onEdgesChange,
    onConnect,
    addNode,
    removeNode,
    updateNodeData,
    setNodes,
    setEdges,
  };
}
