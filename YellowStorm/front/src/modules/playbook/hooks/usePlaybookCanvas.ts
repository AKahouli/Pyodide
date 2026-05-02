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
import { migrateEdge } from '../utils/migrate-ports';
import type { PlaybookTask, PlaybookEdge, PlaybookNodeData, ArtifactKind } from '../types';

const TRIGGER_NODE_ID = '__trigger__';

const MAIL_TRIGGER_PORTS = [
  { id: 'mail_data', name: 'Mail data', artifactKind: 'data' as ArtifactKind },
  { id: 'mail_attachments', name: 'Mail attachments', artifactKind: 'document' as ArtifactKind },
];

function buildTriggerNode(): Node {
  return {
    id: TRIGGER_NODE_ID,
    type: 'playbookTrigger',
    position: { x: 40, y: 160 },
    draggable: true,
    selectable: true,
    data: {
      title: 'Mail Trigger',
      outputPorts: MAIL_TRIGGER_PORTS,
      triggerType: 'mail',
    },
  };
}

export function tasksToNodes(tasks: PlaybookTask[], includeTriggerNode = true): Node[] {
  const taskNodes = tasks.map((task) => ({
    id: task.id,
    type: 'playbookStep',
    position: { x: task.positionX, y: task.positionY },
    data: { ...task } as PlaybookNodeData,
  }));

  return includeTriggerNode ? [buildTriggerNode(), ...taskNodes] : taskNodes;
}

function nodesToTasks(nodes: Node[]): PlaybookTask[] {
  return nodes.filter((node) => node.type === 'playbookStep').map((node) => {
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
    sourceHandle: edge.sourceOutputPortId || undefined,
    targetHandle: edge.targetInputPortId || undefined,
    type: 'animated',
    data: {
      sourceOutputPortId: edge.sourceOutputPortId || 'default',
      targetInputPortId: edge.targetInputPortId || 'default',
      isTypeMatch: undefined,
    },
  }));
}

function flowEdgesToPlaybookEdges(edges: Edge[]): PlaybookEdge[] {
  return edges.map((edge) => {
    const data = (edge.data || {}) as Record<string, unknown>;
    return migrateEdge({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      sourceOutputPortId: data.sourceOutputPortId as string | undefined,
      targetInputPortId: data.targetInputPortId as string | undefined,
    });
  });
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

export interface TriggerNodeActions {
  onDelete: (playbookId: string) => Promise<void>;
  onToggleEnabled: (playbookId: string, enabled: boolean) => Promise<void>;
  onEdit: () => void;
}

export function usePlaybookCanvas(triggerActions?: TriggerNodeActions) {
  const playbook = useCurrentPlaybook();
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);
  const captureSnapshot = usePlaybookStore((s) => s.captureSnapshot);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const canvasSyncVersion = usePlaybookStore((s) => s.canvasSyncVersion);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Keep a ref to the latest nodes so we can read them outside setState updaters
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  // Track which playbook snapshot we've synced to avoid re-syncing on every store update
  const syncedKeyRef = useRef<string | null>(null);

  // Remember trigger node position across rebuilds (not persisted to backend)
  const triggerPositionRef = useRef({ x: 40, y: 160 });

  function buildNodesWithTrigger(tasks: PlaybookTask[], includeTrigger: boolean): Node[] {
    return tasksToNodes(tasks, includeTrigger).map((n) =>
      n.id === TRIGGER_NODE_ID ? { ...n, position: triggerPositionRef.current } : n,
    );
  }

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
      setNodes(buildNodesWithTrigger(playbook.tasks, playbook.automatedTriggerType === 'mail'));
      setEdges(playbookEdgesToFlowEdges(playbook.edges));
    }
  }, [playbook]);

  // Re-sync ReactFlow state after undo/redo (canvasSyncVersion bump)
  useEffect(() => {
    if (!playbook || canvasSyncVersion === 0) return;
    syncedKeyRef.current = `${playbook.id}::${playbook.updatedAt}::v${canvasSyncVersion}`;
    setNodes(buildNodesWithTrigger(playbook.tasks, playbook.automatedTriggerType === 'mail'));
    setEdges(playbookEdgesToFlowEdges(playbook.edges));
  }, [canvasSyncVersion, playbook]);

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
      const selectChanges = changes.filter((change) => change.type === 'select' && 'selected' in change);
      if (selectChanges.length > 0) {
        const selectTrue = selectChanges.find((c) => c.selected === true);
        selectStep(selectTrue ? selectTrue.id : null);
      }

      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length > 0) {
        const triggerRemoved = removes.some((r) => r.id === TRIGGER_NODE_ID);
        const removedIds = new Set(removes.map((r) => r.id));
        if (triggerRemoved && playbook?.id && triggerActions) {
          void triggerActions.onDelete(playbook.id);
        }
        const taskRemovedIds = new Set(removedIds);
        if (triggerRemoved) taskRemovedIds.delete(TRIGGER_NODE_ID);
        if (taskRemovedIds.size > 0) {
          captureSnapshot();
          setNodes((nds) => {
            const updated = nds.filter((n) => !taskRemovedIds.has(n.id));
            deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
            return updated;
          });
          setEdges((eds) => {
            const updated = eds.filter(
              (e) => !taskRemovedIds.has(e.source) && !taskRemovedIds.has(e.target),
            );
            deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
            return updated;
          });
        }
        const nonRemoveChanges = changes.filter((c) => c.type !== 'remove');
        if (nonRemoveChanges.length > 0) {
          setNodes((nds) => applyNodeChanges(nonRemoveChanges, nds));
        }
        return;
      }

      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [selectStep, updateTasks, updateEdges, captureSnapshot],
  );

  // Sync positions to store only when drag ends.
  // Reads from nodesRef instead of setState updater to avoid nested updates.
  // Trigger node position is kept in a ref only (not persisted to backend).
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      if (node.id === TRIGGER_NODE_ID) {
        triggerPositionRef.current = { ...node.position };
        return;
      }
      captureSnapshot();
      updateTasks(nodesToTasks(nodesRef.current));
    },
    [updateTasks, captureSnapshot],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const removes = changes.filter((c) => c.type === 'remove');

      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);
        if (removes.length > 0) {
          captureSnapshot();
          deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
        }
        return updated;
      });
    },
    [updateEdges, captureSnapshot],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        if (wouldCreateCycle(eds, connection.source, connection.target)) {
          return eds;
        }

        const sourceOutputPortId = connection.sourceHandle ?? 'default';
        const targetInputPortId = connection.targetHandle ?? 'default';

        const newEdgeId = `e-${connection.source}-${sourceOutputPortId}-${connection.target}-${targetInputPortId}`;
        if (eds.some((e) => e.id === newEdgeId)) {
          return eds;
        }

        const sourceNode = nodesRef.current.find((n) => n.id === connection.source);
        const targetNode = nodesRef.current.find((n) => n.id === connection.target);
        const sourceData = sourceNode?.data as PlaybookNodeData | undefined;
        const targetData = targetNode?.data as PlaybookNodeData | undefined;
        const sourcePort = sourceData?.outputPorts?.find((p) => p.id === sourceOutputPortId);
        const targetPort = targetData?.inputPorts?.find((p) => p.id === targetInputPortId);
        const isTypeMatch = sourcePort?.artifactKind === targetPort?.artifactKind;

        const newEdge: Edge = {
          id: newEdgeId,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          type: isTypeMatch !== false ? 'animated' : 'animated-warning',
          data: { sourceOutputPortId, targetInputPortId, isTypeMatch },
        };
        captureSnapshot();
        deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges([...eds, newEdge])));
        return [...eds, newEdge];
      });
    },
    [updateEdges, captureSnapshot],
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
        captureSnapshot();
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
    },
    [updateTasks, captureSnapshot],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      if (nodeId === TRIGGER_NODE_ID) {
        if (!playbook?.id || !triggerActions) return;
        void triggerActions.onDelete(playbook.id);
        return;
      }
      captureSnapshot();
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
    [updateTasks, updateEdges, captureSnapshot, playbook?.id, triggerActions],
  );

  const updateNodeData = useCallback(
    (nodeId: string, data: Partial<PlaybookTask>) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
        );
        captureSnapshot();
        updateTasks(nodesToTasks(updated));
        return updated;
      });
    },
    [updateTasks, captureSnapshot],
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
    triggerActions: playbook?.id ? triggerActions : undefined,
  };
}
