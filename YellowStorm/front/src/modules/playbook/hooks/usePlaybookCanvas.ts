/**
 * Playbook Canvas Hook
 * Bridges ReactFlow state with Zustand store using serialization helpers.
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
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { usePlaybookStore, useCurrentPlaybook } from '../store';
import { showWarning } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import {
  tasksToNodes,
  nodesToTasks,
  TRIGGER_NODE_ID,
  repackIteratorChildrenInTasks,
  getIteratorChildAbsolutePositionForNewChild,
} from './helpers/node-serializer';
import {
  playbookEdgesToFlowEdges,
  flowEdgesToPlaybookEdges,
} from './helpers/control-edge-serializer';
import { wouldCreateCycle } from './helpers/cycle-router-validator';
import type { DataBinding, PlaybookTask, PlaybookNodeData } from '../types';
import { getEffectiveNodeType } from '../utils/node-type';

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
  const { t } = useModuleTranslation('playbook');
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);
  const captureSnapshot = usePlaybookStore((s) => s.captureSnapshot);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const canvasSyncVersion = usePlaybookStore((s) => s.canvasSyncVersion);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const dataBindingsRef = useRef<DataBinding[]>(playbook?.dataBindings ?? []);
  const syncedKeyRef = useRef<string | null>(null);
  const triggerPosRef = useRef({ x: 40, y: 160 });

  const syncEdges = useCallback((nextEdges: Edge[]) => {
    updateEdges(flowEdgesToPlaybookEdges(nextEdges));
  }, [updateEdges]);

  const syncDataBindings = useCallback((nextBindings: DataBinding[]) => {
    dataBindingsRef.current = nextBindings;
    updateDataBindings(nextBindings);
  }, [updateDataBindings]);

  function buildNodes(tasks: PlaybookTask[], includeTrigger: boolean): Node[] {
    return tasksToNodes(tasks, includeTrigger).map((n) =>
      n.id === TRIGGER_NODE_ID ? { ...n, position: triggerPosRef.current } : n,
    );
  }

  function preserveUI(nodes: Node[], prev: Node[]): Node[] {
    const prevById = new Map(prev.map((n) => [n.id, n]));
    return nodes.map((n) => {
      const prevNode = prevById.get(n.id);
      if (!prevNode) return n;
      return { ...n, selected: prevNode.selected, dragging: prevNode.dragging };
    });
  }

  // Sync on playbook load / data change
  useEffect(() => {
    if (!playbook) return;
    const key = `${playbook.id}::${playbook.updatedAt}`;
    if (syncedKeyRef.current !== key) {
      syncedKeyRef.current = key;
      const includeTrigger = playbook.automatedTriggerType === 'mail';
      const nextNodes = buildNodes(playbook.tasks, includeTrigger);
      const nextEdges = playbookEdgesToFlowEdges(playbook.edges, playbook.tasks);
      setNodes(nextNodes);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
    }
  }, [playbook]);

  // Sync on undo/redo
  useEffect(() => {
    if (!playbook || canvasSyncVersion === 0) return;
    const key = `${playbook.id}::${playbook.updatedAt}::v${canvasSyncVersion}`;
    syncedKeyRef.current = key;
    const includeTrigger = playbook.automatedTriggerType === 'mail';
    const nextNodes = buildNodes(playbook.tasks, includeTrigger);
    const nextEdges = playbookEdgesToFlowEdges(playbook.edges, playbook.tasks);
    setNodes(nextNodes);
    setEdges(nextEdges);
    edgesRef.current = nextEdges;
  }, [canvasSyncVersion, playbook]);

  // Sync node metadata when tasks change locally
  useEffect(() => {
    if (!playbook) return;
    setNodes((nds) => {
      const rebuilt = preserveUI(
        buildNodes(playbook.tasks, playbook.automatedTriggerType === 'mail'),
        nds,
      );
      return JSON.stringify(rebuilt) === JSON.stringify(nds) ? nds : rebuilt;
    });
  }, [playbook?.tasks, playbook?.automatedTriggerType]);

  useEffect(() => {
    dataBindingsRef.current = playbook?.dataBindings ?? [];
  }, [playbook?.dataBindings]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const selectChanges = changes.filter((c) => c.type === 'select' && 'selected' in c);
      if (selectChanges.length > 0) {
        const selected = selectChanges.filter((c) => c.selected === true);
        selectStep(selected.length === 1 ? selected[0].id : null);
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
            edgesRef.current = updated;
            deferStoreUpdate(() => syncEdges(updated));
            return updated;
          });
          const updatedBindings = dataBindingsRef.current.filter(
            (binding) => !removedIds.has(binding.targetNode) && !removedIds.has(binding.sourceNode ?? ''),
          );
          if (updatedBindings.length !== dataBindingsRef.current.length) {
            deferStoreUpdate(() => syncDataBindings(updatedBindings));
          }
          const nonRemove = changes.filter((c) => c.type !== 'remove');
          if (nonRemove.length > 0) setNodes((nds) => applyNodeChanges(nonRemove, nds));
          return;
        }
      }
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [captureSnapshot, selectStep, syncEdges, updateTasks],
  );

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      if (node.id === TRIGGER_NODE_ID) {
        triggerPosRef.current = { ...node.position };
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
        if (removes.length > 0) return eds;
        const updated = applyEdgeChanges(changes, eds);
        edgesRef.current = updated;
        return updated;
      });
    },
    [],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const currentEdges = edgesRef.current;
      const currentTasks = nodesToTasks(nodesRef.current);
      const sourceNode = nodesRef.current.find((n) => n.id === connection.source);
      const sourceData = sourceNode?.data as PlaybookNodeData | undefined;
      const sourceType = sourceData ? getEffectiveNodeType(sourceData) : null;
      const isRouterSource = sourceType === 'router';
      const routerLabel = isRouterSource ? (connection.sourceHandle ?? null) : null;
      const sourceHandleId = connection.sourceHandle ?? 'default';
      const targetHandleId = connection.targetHandle ?? 'default';
      const edgeId = `e-${connection.source}-${sourceHandleId}-${connection.target}-${targetHandleId}`;

      const targetNode = nodesRef.current.find((n) => n.id === connection.target);
      const targetData = targetNode?.data as PlaybookNodeData | undefined;
      const sourcePort = sourceData?.outputPorts?.find((p) => p.id === sourceHandleId);
      const targetPort = targetData?.inputPorts?.find((p) => p.id === targetHandleId);
      const typeMatch = sourcePort?.artifactKind === targetPort?.artifactKind;
      const isErrorEdge = routerLabel === '__error__';
      const createsTriggerBinding = connection.source === TRIGGER_NODE_ID && Boolean(targetPort);
      const createsNodeOutputBinding = !isRouterSource && Boolean(sourcePort) && Boolean(targetPort);

      if (createsTriggerBinding) {
        const nextBinding: DataBinding = createsTriggerBinding
          ? {
              id: `db-trigger-${sourceHandleId}-${connection.target}-${targetHandleId}`,
              targetNode: connection.target,
              targetPort: targetHandleId,
              sourceKind: 'trigger',
              triggerPath: sourceHandleId,
            }
          : {
              id: `db-${connection.source}-${sourceHandleId}-${connection.target}-${targetHandleId}`,
              targetNode: connection.target,
              targetPort: targetHandleId,
              sourceKind: 'node-output',
              sourceNode: connection.source,
              sourcePort: sourceHandleId,
              iteration: 'current',
            };
        const nextBindings = [
          ...dataBindingsRef.current.filter(
            (binding) => !(binding.targetNode === nextBinding.targetNode && binding.targetPort === nextBinding.targetPort),
          ),
          nextBinding,
        ];
        captureSnapshot();
        dataBindingsRef.current = nextBindings;
        deferStoreUpdate(() => syncDataBindings(nextBindings));
        return;
      }

      const nextEdgeBase = createsNodeOutputBinding
        ? currentEdges.filter((edge) => {
            const edgeData = (edge.data || {}) as { targetInputPortId?: string; routerLabel?: string | null };
            const edgeTargetPortId = edgeData.targetInputPortId || edge.targetHandle || 'default';
            const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
            if (isConditionalEdge) {
              return true;
            }
            return !(edge.target === connection.target && edgeTargetPortId === targetHandleId);
          })
        : currentEdges;

      const cycleNodes = currentTasks.map((t) => ({
        id: t.id,
        data: { ...t, nodeType: t.nodeType ?? undefined },
      }));
      if (wouldCreateCycle(nextEdgeBase, connection.source, connection.target, cycleNodes)) {
        showWarning(t('canvas.cycleRejected'));
        return;
      }

      if (nextEdgeBase.some((edge) => edge.id === edgeId)) return;

      if (createsNodeOutputBinding) {
        const nextBinding: DataBinding = {
          id: `db-${connection.source}-${sourceHandleId}-${connection.target}-${targetHandleId}`,
          targetNode: connection.target,
          targetPort: targetHandleId,
          sourceKind: 'node-output',
          sourceNode: connection.source,
          sourcePort: sourceHandleId,
          iteration: 'current',
        };
        dataBindingsRef.current = [
          ...dataBindingsRef.current.filter(
            (binding) => !(binding.targetNode === nextBinding.targetNode && binding.targetPort === nextBinding.targetPort),
          ),
          nextBinding,
        ];
      }

      const newEdge: Edge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: isRouterSource ? 'conditional' : (typeMatch !== false ? 'animated' : 'animated-warning'),
        animated: !isRouterSource,
        data: {
          sourceOutputPortId: sourceHandleId,
          targetInputPortId: targetHandleId,
          isTypeMatch: isRouterSource ? undefined : typeMatch,
          routerLabel,
        },
        style: isRouterSource
          ? {
              strokeDasharray: '6 4',
              ...(isErrorEdge ? { stroke: 'var(--destructive)' } : {}),
            }
          : undefined,
      };

      const nextEdges = [...nextEdgeBase, newEdge];
      edgesRef.current = nextEdges;
      captureSnapshot();
      setEdges(nextEdges);
      if (createsNodeOutputBinding) {
        deferStoreUpdate(() => syncDataBindings(dataBindingsRef.current));
      }
      deferStoreUpdate(() => syncEdges(nextEdges));
    },
    [captureSnapshot, syncDataBindings, syncEdges, t],
  );

  const addNode = useCallback(
    (task: PlaybookTask) => {
      setNodes((nds) => {
        const tasks = [...nodesToTasks(nds), task];
        const updated = preserveUI(
          buildNodes(tasks, playbook?.automatedTriggerType === 'mail'),
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
        if (playbook?.id && triggerActions) void triggerActions.onDelete(playbook.id);
        return;
      }
      captureSnapshot();
      setNodes((nds) => {
        const updated = nds.filter((n) => n.id !== nodeId);
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });
      setEdges((eds) => {
        const updated = eds.filter((e) => e.source !== nodeId && e.target !== nodeId);
        edgesRef.current = updated;
        deferStoreUpdate(() => syncEdges(updated));
        return updated;
      });
      const updatedBindings = dataBindingsRef.current.filter(
        (binding) => binding.targetNode !== nodeId && binding.sourceNode !== nodeId,
      );
      if (updatedBindings.length !== dataBindingsRef.current.length) {
        deferStoreUpdate(() => syncDataBindings(updatedBindings));
      }
    },
    [captureSnapshot, playbook?.id, syncDataBindings, syncEdges, triggerActions, updateTasks],
  );

  const updateNodeData = useCallback(
    (nodeId: string, data: Partial<PlaybookTask>) => {
      setNodes((nds) => {
        const tasks = nodesToTasks(nds);
        const prevTask = tasks.find((t) => t.id === nodeId);
        const nextParentId = data.containerConfig
          ? data.containerConfig.parentIteratorId ?? null
          : prevTask?.containerConfig?.parentIteratorId ?? null;
        const isNewAssignment =
          nextParentId && nextParentId !== prevTask?.containerConfig?.parentIteratorId;

        const patched = tasks.map((t) => {
          if (t.id !== nodeId) return t;
          const nextTask = {
            ...t,
            ...data,
            containerConfig: data.containerConfig ?? t.containerConfig,
          };
          if (isNewAssignment) {
            const pos = getIteratorChildAbsolutePositionForNewChild(tasks, nextParentId!);
            if (pos) {
              nextTask.positionX = pos.x;
              nextTask.positionY = pos.y;
            }
          }
          return nextTask;
        });
        const updated = preserveUI(
          buildNodes(patched, playbook?.automatedTriggerType === 'mail'),
          nds,
        );
        captureSnapshot();
        updateTasks(nodesToTasks(updated));
        return updated;
      });
    },
    [updateTasks, captureSnapshot, playbook?.automatedTriggerType],
  );

  const setIteratorNodeSize = useCallback(
    (nodeId: string, size: { width: number; height: number }) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId || node.type !== 'playbookIteratorContainer') return node;
          const w = Math.round(size.width);
          const h = Math.round(size.height);
          return {
            ...node,
            style: { ...(node.style || {}), width: w, height: h },
            data: { ...(node.data as PlaybookNodeData), width: w, height: h },
          };
        }),
      );
    },
    [],
  );

  const repackIteratorChildren = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const repacked = repackIteratorChildrenInTasks(nodesToTasks(nds), nodeId);
        const updated = preserveUI(
          buildNodes(repacked, playbook?.automatedTriggerType === 'mail'),
          nds,
        );
        captureSnapshot();
        updateTasks(nodesToTasks(updated));
        return updated;
      });
    },
    [captureSnapshot, playbook?.automatedTriggerType, updateTasks],
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
    setIteratorNodeSize,
    repackIteratorChildren,
    setNodes,
    setEdges,
    triggerActions: playbook?.id ? triggerActions : undefined,
  };
}
