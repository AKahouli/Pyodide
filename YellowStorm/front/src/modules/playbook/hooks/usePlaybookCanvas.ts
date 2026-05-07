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
const ITERATOR_HEADER_HEIGHT = 56;
const ITERATOR_PADDING = 32;
const ITERATOR_MIN_WIDTH = 360;
const ITERATOR_MIN_HEIGHT = 220;
const ITERATOR_CHILD_STACK_OFFSET = 56;
const ITERATOR_CHILD_NODE_WIDTH = 384;
const ITERATOR_CHILD_NODE_HEIGHT = 240;

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

function getIteratorChildTasks(tasks: PlaybookTask[], iteratorId: string): PlaybookTask[] {
  return tasks.filter((task) => task.containerConfig?.parentIteratorId === iteratorId);
}

function buildIteratorContainerNode(task: PlaybookTask, childTasks: PlaybookTask[]): Node {
  const bounds = childTasks.reduce(
    (acc, child) => {
      const relativeX = child.positionX - task.positionX;
      const relativeY = child.positionY - task.positionY;
      acc.maxX = Math.max(acc.maxX, relativeX + ITERATOR_CHILD_NODE_WIDTH);
      acc.maxY = Math.max(acc.maxY, relativeY + ITERATOR_CHILD_NODE_HEIGHT);
      return acc;
    },
    {
      maxX: ITERATOR_MIN_WIDTH,
      maxY: ITERATOR_MIN_HEIGHT,
    },
  );

  const width = Math.max(ITERATOR_MIN_WIDTH, bounds.maxX + ITERATOR_PADDING);
  const height = Math.max(ITERATOR_MIN_HEIGHT, bounds.maxY + ITERATOR_PADDING);

  return {
    id: task.id,
    type: 'playbookIteratorContainer',
    position: { x: task.positionX, y: task.positionY },
    data: { ...task, width, height, childTaskIds: childTasks.map((child) => child.id) } as PlaybookNodeData,
    style: { width, height },
  };
}

function getIteratorNodeMap(tasks: PlaybookTask[]): Map<string, PlaybookTask> {
  return new Map(tasks.filter((task) => task.taskType === 'iterator').map((task) => [task.id, task]));
}

function toAbsoluteTaskPosition(node: Node, nodeMap: Map<string, Node>): { x: number; y: number } {
  if (!node.parentId) {
    return { x: node.position.x, y: node.position.y };
  }

  const parentNode = nodeMap.get(node.parentId);
  if (!parentNode) {
    return { x: node.position.x, y: node.position.y };
  }

  return {
    x: parentNode.position.x + node.position.x,
    y: parentNode.position.y + node.position.y,
  };
}

function buildChildFlowNode(task: PlaybookTask, iteratorTasks: Map<string, PlaybookTask>): Node {
  const parentIteratorId = task.containerConfig?.parentIteratorId;
  const parentIterator = parentIteratorId ? iteratorTasks.get(parentIteratorId) : null;
  const isScoped = Boolean(parentIteratorId && parentIterator);

  return {
    id: task.id,
    type: 'playbookStep',
    position: isScoped && parentIterator
      ? {
          x: task.positionX - parentIterator.positionX,
          y: task.positionY - parentIterator.positionY,
        }
      : { x: task.positionX, y: task.positionY },
    parentId: isScoped ? parentIteratorId ?? undefined : undefined,
    extent: isScoped ? 'parent' as const : undefined,
    data: { ...task } as PlaybookNodeData,
  };
}

function getAssignedChildAbsolutePosition(tasks: PlaybookTask[], iteratorId: string): { x: number; y: number } | null {
  const iteratorTask = tasks.find((task) => task.id === iteratorId && task.taskType === 'iterator');
  if (!iteratorTask) {
    return null;
  }

  const siblingCount = tasks.filter((task) => task.containerConfig?.parentIteratorId === iteratorId).length;
  return {
    x: iteratorTask.positionX + ITERATOR_PADDING,
    y: iteratorTask.positionY + ITERATOR_HEADER_HEIGHT + 16 + siblingCount * ITERATOR_CHILD_STACK_OFFSET,
  };
}

export function tasksToNodes(tasks: PlaybookTask[], includeTriggerNode = true): Node[] {
  const iteratorTasks = getIteratorNodeMap(tasks);
  const iteratorNodes = tasks
    .filter((task) => task.taskType === 'iterator')
    .map((task) => buildIteratorContainerNode(task, getIteratorChildTasks(tasks, task.id)));
  const stepNodes = tasks
    .filter((task) => task.taskType !== 'iterator')
    .map((task) => buildChildFlowNode(task, iteratorTasks));
  const taskNodes: Node[] = [...iteratorNodes, ...stepNodes];

  return includeTriggerNode ? [buildTriggerNode(), ...taskNodes] : taskNodes;
}

function nodesToTasks(nodes: Node[]): PlaybookTask[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => node.type === 'playbookStep' || node.type === 'playbookIteratorContainer').map((node) => {
    const data = node.data as PlaybookNodeData;
    const absolutePosition = toAbsoluteTaskPosition(node, nodeMap);
    return {
      ...data,
      id: node.id,
      positionX: absolutePosition.x,
      positionY: absolutePosition.y,
      containerConfig:
        node.type === 'playbookStep'
          ? {
              parentIteratorId: node.parentId || null,
            }
          : data.containerConfig ?? null,
    };
  });
}

function playbookEdgesToFlowEdges(edges: PlaybookEdge[]): Edge[] {
  return edges
    .filter((edge) => edge.sourceId !== edge.targetId)
    .map((edge) => ({
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

  function preserveNodeUiState(nextNodes: Node[], previousNodes: Node[]): Node[] {
    const previousById = new Map(previousNodes.map((node) => [node.id, node]));
    return nextNodes.map((node) => {
      const previous = previousById.get(node.id);
      if (!previous) {
        return node;
      }
      return {
        ...node,
        selected: previous.selected,
        dragging: previous.dragging,
      };
    });
  }

  function applyTaskPatch(tasks: PlaybookTask[], taskId: string, patch: Partial<PlaybookTask>): PlaybookTask[] {
    const previousTask = tasks.find((task) => task.id === taskId);
    const nextParentIteratorId = patch.containerConfig
      ? patch.containerConfig.parentIteratorId ?? null
      : previousTask?.containerConfig?.parentIteratorId ?? null;

    return tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      const nextTask: PlaybookTask = {
        ...task,
        ...patch,
        containerConfig: patch.containerConfig ?? task.containerConfig,
      };

      if (nextParentIteratorId && nextParentIteratorId !== task.containerConfig?.parentIteratorId) {
        const assignedPosition = getAssignedChildAbsolutePosition(tasks, nextParentIteratorId);
        if (assignedPosition) {
          nextTask.positionX = assignedPosition.x;
          nextTask.positionY = assignedPosition.y;
        }
      }

      return nextTask;
    });
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

    setNodes((nds) => {
      const rebuilt = preserveNodeUiState(
        buildNodesWithTrigger(playbook.tasks, playbook.automatedTriggerType === 'mail'),
        nds,
      );

      if (JSON.stringify(rebuilt) === JSON.stringify(nds)) {
        return nds;
      }

      return rebuilt;
    });
  }, [playbook?.tasks, playbook?.automatedTriggerType]);

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
        const removedIds = new Set(removes.map((r) => r.id).filter((id) => id !== TRIGGER_NODE_ID));
        if (removedIds.size > 0) {
          captureSnapshot();
          setNodes((nds) => {
        const updated = nds.filter((n) => !removedIds.has(n.id));
            deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
            return updated;
          });
          setEdges((eds) => {
            const updated = eds.filter(
              (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
            );
            deferStoreUpdate(() => updateEdges(flowEdgesToPlaybookEdges(updated)));
            return updated;
          });
          const nonRemoveChanges = changes.filter((c) => c.type !== 'remove');
          if (nonRemoveChanges.length > 0) {
            setNodes((nds) => applyNodeChanges(nonRemoveChanges, nds));
          }
          return;
        }
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
      setNodes((nds) => {
        const tasks = [...nodesToTasks(nds), task];
        const updated = preserveNodeUiState(
          buildNodesWithTrigger(tasks, playbook?.automatedTriggerType === 'mail'),
          nds,
        );
        captureSnapshot();
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
    },
    [updateTasks, captureSnapshot, playbook?.automatedTriggerType],
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
        const patchedTasks = applyTaskPatch(nodesToTasks(nds), nodeId, data);
        const updated = preserveNodeUiState(
          buildNodesWithTrigger(patchedTasks, playbook?.automatedTriggerType === 'mail'),
          nds,
        );
        captureSnapshot();
        updateTasks(nodesToTasks(updated));
        return updated;
      });
    },
    [updateTasks, captureSnapshot, playbook?.automatedTriggerType],
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
