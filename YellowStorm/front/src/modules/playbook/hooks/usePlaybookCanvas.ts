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
  type OnConnectStart,
  type OnConnectEnd,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import { usePlaybookStore, useCurrentPlaybook } from '../store';
import { showWarning, showInfo, showSuccess } from '@/lib/notifications';
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
import type { DataBinding, PlaybookTask, PlaybookNodeData, ArtifactKind } from '../types';
import { getEffectiveNodeType } from '../utils/node-type';
import { hasArtifactKindMismatch, createCompatibleInputPort } from '../utils/port-compatibility';
import {
  buildClipboardPayload,
  writeClipboard,
  readClipboard,
  remapClipboardPayload,
  removeCutSourceItems,
  checkPasteCompatibility,
} from '../utils/playbookClipboard';
import * as playbookApi from '../api';
import { useAgentStore } from '@/modules/agent/store';

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
  const { screenToFlowPosition } = useReactFlow();
  const updateTasks = usePlaybookStore((s) => s.updateTasks);
  const updateEdges = usePlaybookStore((s) => s.updateEdges);
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);
  const captureSnapshot = usePlaybookStore((s) => s.captureSnapshot);
  const selectStep = usePlaybookStore((s) => s.selectStep);
  const canvasSyncVersion = usePlaybookStore((s) => s.canvasSyncVersion);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [pendingMismatch, setPendingMismatch] = useState<{
    connection: Connection;
    sourcePortName: string;
    sourceArtifactKind: ArtifactKind;
    targetPortName: string;
    targetArtifactKind: ArtifactKind;
  } | null>(null);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const dataBindingsRef = useRef<DataBinding[]>(playbook?.dataBindings ?? []);
  const syncedKeyRef = useRef<string | null>(null);
  const triggerPosRef = useRef({ x: 40, y: 160 });
  const pasteCountRef = useRef(0);
  const connectHandledRef = useRef(false);

  const getSelectedTaskNodes = useCallback((): Node[] => {
    return nodesRef.current.filter(
      (n) => n.selected && n.id !== TRIGGER_NODE_ID && n.type !== 'playbookTrigger',
    );
  }, []);

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
      connectHandledRef.current = true;
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

      if (createsNodeOutputBinding && hasArtifactKindMismatch(sourcePort?.artifactKind, targetPort?.artifactKind)) {
        setPendingMismatch({
          connection,
          sourcePortName: sourcePort!.name || sourcePort!.id,
          sourceArtifactKind: sourcePort!.artifactKind,
          targetPortName: targetPort!.name || targetPort!.id,
          targetArtifactKind: targetPort!.artifactKind,
        });
        return;
      }

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

  const commitEdgeAndBinding = useCallback(
    (sourceId: string, sourceHandle: string | null, targetId: string, targetHandle: string | null) => {
      const sourceHandleId = sourceHandle ?? 'default';
      const targetHandleId = targetHandle ?? 'default';
      const edgeId = `e-${sourceId}-${sourceHandleId}-${targetId}-${targetHandleId}`;

      const nextBinding: DataBinding = {
        id: `db-${sourceId}-${sourceHandleId}-${targetId}-${targetHandleId}`,
        targetNode: targetId,
        targetPort: targetHandleId,
        sourceKind: 'node-output',
        sourceNode: sourceId,
        sourcePort: sourceHandleId,
        iteration: 'current',
      };
      dataBindingsRef.current = [
        ...dataBindingsRef.current.filter(
          (b) => !(b.targetNode === nextBinding.targetNode && b.targetPort === nextBinding.targetPort),
        ),
        nextBinding,
      ];

      const nextEdgeBase = edgesRef.current.filter((edge) => {
        const edgeData = (edge.data || {}) as { targetInputPortId?: string; routerLabel?: string | null };
        const edgeTargetPortId = edgeData.targetInputPortId || edge.targetHandle || 'default';
        const isConditionalEdge = edge.type === 'conditional' || Boolean(edgeData.routerLabel);
        if (isConditionalEdge) return true;
        return !(edge.target === targetId && edgeTargetPortId === targetHandleId);
      });

      if (nextEdgeBase.some((edge) => edge.id === edgeId)) return;

      const newEdge: Edge = {
        id: edgeId,
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: 'animated',
        animated: true,
        data: {
          sourceOutputPortId: sourceHandleId,
          targetInputPortId: targetHandleId,
          isTypeMatch: true,
          routerLabel: null,
        },
      };

      const nextEdges = [...nextEdgeBase, newEdge];
      edgesRef.current = nextEdges;
      captureSnapshot();
      setEdges(nextEdges);
      deferStoreUpdate(() => syncDataBindings(dataBindingsRef.current));
      deferStoreUpdate(() => syncEdges(nextEdges));
    },
    [captureSnapshot, syncDataBindings, syncEdges],
  );

  const connectStartRef = useRef<{ nodeId: string | null; handleId: string | null; handleType: string | null } | null>(null);

  const [connectionDragHoveredId, setConnectionDragHoveredId] = useState<string | null>(null);

  const onConnectStartHandler: OnConnectStart = useCallback((_event, { nodeId, handleId, handleType }) => {
    connectStartRef.current = { nodeId, handleId, handleType };
  }, []);

  const autoConnectToNodeBody = useCallback(
    (targetNodeId: string) => {
      const start = connectStartRef.current;
      if (!start?.nodeId || start.handleType !== 'source' || start.nodeId === targetNodeId) return false;

      const sourceNode = nodesRef.current.find((n) => n.id === start.nodeId);
      const targetNode = nodesRef.current.find((n) => n.id === targetNodeId);
      const sourceData = sourceNode?.data as PlaybookNodeData | undefined;
      const targetData = targetNode?.data as PlaybookNodeData | undefined;
      if (!sourceData || !targetData) return false;

      const sourceType = getEffectiveNodeType(sourceData);
      if (sourceType === 'router' || start.nodeId === TRIGGER_NODE_ID) return false;

      const sourceHandleId = start.handleId ?? 'default';
      const sourcePort = sourceData.outputPorts?.find((p) => p.id === sourceHandleId);
      if (!sourcePort) return false;

      const currentTasks = nodesToTasks(nodesRef.current);
      const cycleNodes = currentTasks.map((t) => ({
        id: t.id,
        data: { ...t, nodeType: t.nodeType ?? undefined },
      }));
      if (wouldCreateCycle(edgesRef.current, start.nodeId, targetNodeId, cycleNodes)) {
        showWarning(t('canvas.cycleRejected'));
        return false;
      }

      const newPort = createCompatibleInputPort(sourcePort.name || sourcePort.id, sourcePort.artifactKind);
      const updatedInputPorts = [...(targetData.inputPorts ?? []), newPort];

      setNodes((nds) => {
        const updated = nds.map((n) => {
          if (n.id !== targetNodeId) return n;
          return { ...n, data: { ...n.data, inputPorts: updatedInputPorts } };
        });
        nodesRef.current = updated;
        deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
        return updated;
      });

      commitEdgeAndBinding(start.nodeId, start.handleId, targetNodeId, newPort.id);
      return true;
    },
    [commitEdgeAndBinding, t, updateTasks],
  );

  const onConnectEndHandler: OnConnectEnd = useCallback(
    (event) => {
      setConnectionDragHoveredId(null);
      const start = connectStartRef.current;
      connectStartRef.current = null;
      if (!start?.nodeId || start.handleType !== 'source') return;

      if (connectHandledRef.current) {
        connectHandledRef.current = false;
        return;
      }

      const flowPos = screenToFlowPosition({
        x: (event as MouseEvent).clientX,
        y: (event as MouseEvent).clientY,
      });

      let targetNodeId: string | null = null;
      for (const node of nodesRef.current) {
        const { position, measured } = node;
        const width = measured?.width ?? (node as Node & { width?: number }).width ?? 0;
        const height = measured?.height ?? (node as Node & { height?: number }).height ?? 0;
        if (
          flowPos.x >= position.x &&
          flowPos.x <= position.x + width &&
          flowPos.y >= position.y &&
          flowPos.y <= position.y + height
        ) {
          targetNodeId = node.id;
          break;
        }
      }

      if (!targetNodeId || targetNodeId === start.nodeId) return;

      autoConnectToNodeBody(targetNodeId);
    },
    [autoConnectToNodeBody, screenToFlowPosition],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!connectStartRef.current?.nodeId || connectStartRef.current.handleType !== 'source') return;
      if (node.id === connectStartRef.current.nodeId || node.id === TRIGGER_NODE_ID) return;
      setConnectionDragHoveredId(node.id);
    },
    [],
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    (_event, node) => {
      setConnectionDragHoveredId((prev) => (prev === node.id ? null : prev));
    },
    [],
  );

  const resolveMismatchUpdateExisting = useCallback(() => {
    if (!pendingMismatch) return;
    const { connection } = pendingMismatch;
    setPendingMismatch(null);

    const targetNode = nodesRef.current.find((n) => n.id === connection.target);
    const targetData = targetNode?.data as PlaybookNodeData | undefined;
    const sourceData = (nodesRef.current.find((n) => n.id === connection.source)?.data) as PlaybookNodeData | undefined;
    const sourcePort = sourceData?.outputPorts?.find((p) => p.id === (connection.sourceHandle ?? 'default'));
    const targetPort = targetData?.inputPorts?.find((p) => p.id === (connection.targetHandle ?? 'default'));
    if (!sourcePort || !targetPort || !targetData) return;

    const updatedInputPorts = targetData.inputPorts?.map((p) =>
      p.id === targetPort.id ? { ...p, artifactKind: sourcePort.artifactKind } : p,
    ) ?? targetData.inputPorts;

    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (n.id !== connection.target) return n;
        return { ...n, data: { ...n.data, inputPorts: updatedInputPorts } };
      });
      nodesRef.current = updated;
      deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
      return updated;
    });

    commitEdgeAndBinding(connection.source, connection.sourceHandle, connection.target, connection.targetHandle);
  }, [pendingMismatch, updateTasks, commitEdgeAndBinding]);

  const resolveMismatchCreateCompatible = useCallback(() => {
    if (!pendingMismatch) return;
    const { connection, sourcePortName, sourceArtifactKind } = pendingMismatch;
    setPendingMismatch(null);

    const targetNode = nodesRef.current.find((n) => n.id === connection.target);
    const targetData = targetNode?.data as PlaybookNodeData | undefined;
    const sourceData = (nodesRef.current.find((n) => n.id === connection.source)?.data) as PlaybookNodeData | undefined;
    const sourcePort = sourceData?.outputPorts?.find((p) => p.id === (connection.sourceHandle ?? 'default'));
    if (!sourcePort || !targetData) return;

    const newPort = createCompatibleInputPort(sourcePortName, sourceArtifactKind);
    const updatedInputPorts = [...(targetData.inputPorts ?? []), newPort];

    setNodes((nds) => {
      const updated = nds.map((n) => {
        if (n.id !== connection.target) return n;
        return { ...n, data: { ...n.data, inputPorts: updatedInputPorts } };
      });
      nodesRef.current = updated;
      deferStoreUpdate(() => updateTasks(nodesToTasks(updated)));
      return updated;
    });

    commitEdgeAndBinding(connection.source, connection.sourceHandle, connection.target, newPort.id);
  }, [pendingMismatch, updateTasks, commitEdgeAndBinding]);

  const dismissMismatch = useCallback(() => {
    setPendingMismatch(null);
  }, []);

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

  const copySelection = useCallback(async (): Promise<number> => {
    const selectedNodes = getSelectedTaskNodes();
    if (selectedNodes.length === 0 || !playbook) return 0;

    const selectedTaskIds = new Set(selectedNodes.map((n) => n.id));
    const allTasks = nodesToTasks(nodesRef.current);
    const allPlaybookEdges = playbook.edges ?? [];
    const allDataBindings = playbook.dataBindings ?? [];

    const payload = buildClipboardPayload({
      tasks: allTasks,
      allEdges: allPlaybookEdges,
      allDataBindings,
      selectedTaskIds,
      sourcePlaybookId: playbook.id,
      sourcePlaybookName: playbook.name,
      operation: 'copy',
    });

    await writeClipboard(payload);
    pasteCountRef.current = 0;
    showInfo(t('clipboard.copied', { count: payload.tasks.length }));
    return payload.tasks.length;
  }, [getSelectedTaskNodes, playbook, t]);

  const cutSelection = useCallback(async (): Promise<number> => {
    const selectedNodes = getSelectedTaskNodes();
    if (selectedNodes.length === 0 || !playbook) return 0;

    const selectedTaskIds = new Set(selectedNodes.map((n) => n.id));
    const allTasks = nodesToTasks(nodesRef.current);
    const allPlaybookEdges = playbook.edges ?? [];
    const allDataBindings = playbook.dataBindings ?? [];

    const payload = buildClipboardPayload({
      tasks: allTasks,
      allEdges: allPlaybookEdges,
      allDataBindings,
      selectedTaskIds,
      sourcePlaybookId: playbook.id,
      sourcePlaybookName: playbook.name,
      operation: 'cut',
    });

    await writeClipboard(payload);
    pasteCountRef.current = 0;
    showInfo(t('clipboard.cut', { count: payload.tasks.length }));
    return payload.tasks.length;
  }, [getSelectedTaskNodes, playbook, t]);

  const pasteClipboard = useCallback(async (viewportCenter?: { x: number; y: number } | null): Promise<string[]> => {
    if (!playbook) return [];

    const payload = await readClipboard();
    if (!payload || payload.tasks.length === 0) {
      showWarning(t('clipboard.empty'));
      return [];
    }

    const result = remapClipboardPayload(payload, {
      pasteCount: pasteCountRef.current,
      viewportCenter: viewportCenter ?? null,
    });

    pasteCountRef.current += 1;

    const currentTasks = nodesToTasks(nodesRef.current);
    const mergedTasks = [...currentTasks, ...result.tasks];

    const currentEdges = playbook.edges ?? [];
    const mergedEdges = [...currentEdges, ...result.edges];

    const currentBindings = playbook.dataBindings ?? [];
    const mergedBindings = [...currentBindings, ...result.dataBindings];

    captureSnapshot();

    setNodes((nds) => {
      const rebuilt = buildNodes(mergedTasks, playbook.automatedTriggerType === 'mail');
      const selected = rebuilt.map((n) =>
        result.pastedTaskIds.includes(n.id) ? { ...n, selected: true } : { ...n, selected: false },
      );
      deferStoreUpdate(() => updateTasks(nodesToTasks(selected)));
      return selected;
    });

    const newFlowEdges = playbookEdgesToFlowEdges(mergedEdges, mergedTasks);
    setEdges(newFlowEdges);
    edgesRef.current = newFlowEdges;
    deferStoreUpdate(() => syncEdges(newFlowEdges));

    dataBindingsRef.current = mergedBindings;
    deferStoreUpdate(() => syncDataBindings(mergedBindings));

    if (payload.operation === 'cut' && payload.sourcePlaybookId === playbook.id) {
      const sourceIds = new Set(payload.sourceTaskIds);
      setNodes((nds) => {
        const withoutSource = nds.filter((n) => !sourceIds.has(n.id));
        deferStoreUpdate(() => updateTasks(nodesToTasks(withoutSource)));
        return withoutSource;
      });
      setEdges((eds) => {
        const withoutSource = eds.filter(
          (e) => !sourceIds.has(e.source) && !sourceIds.has(e.target),
        );
        edgesRef.current = withoutSource;
        deferStoreUpdate(() => syncEdges(withoutSource));
        return withoutSource;
      });
      const cleanedBindings = dataBindingsRef.current.filter(
        (binding) => !sourceIds.has(binding.targetNode) && !(binding.sourceNode && sourceIds.has(binding.sourceNode)),
      );
      dataBindingsRef.current = cleanedBindings;
      deferStoreUpdate(() => syncDataBindings(cleanedBindings));
    }

    if (payload.operation === 'cut' && payload.sourcePlaybookId !== playbook.id) {
      try {
        const sourcePlaybook = await playbookApi.getPlaybook(payload.sourcePlaybookId);
        const cleaned = removeCutSourceItems(
          {
            tasks: sourcePlaybook.tasks ?? [],
            edges: sourcePlaybook.edges ?? [],
            dataBindings: sourcePlaybook.dataBindings ?? [],
          },
          payload.sourceTaskIds,
        );
        await playbookApi.updatePlaybook(payload.sourcePlaybookId, {
          tasks: cleaned.tasks,
          edges: cleaned.edges,
          dataBindings: cleaned.dataBindings,
          expectedUpdatedAt: sourcePlaybook.updatedAt,
        });
      } catch {
        showWarning(t('clipboard.crossPlaybookCleanupFailed', { name: payload.sourcePlaybookName ?? payload.sourcePlaybookId }));
      }
    }

    selectStep(result.pastedTaskIds.length === 1 ? result.pastedTaskIds[0] : null);
    showSuccess(t('clipboard.pasted', { count: result.tasks.length }));

    const { agents } = useAgentStore.getState();
    const context = {
      agentIds: agents.length > 0 ? new Set(agents.map((a) => a.id)) : null,
      workspaceIds: new Set(playbook.workspaces ?? []),
      connectorIds: null as Set<string> | null,
    };
    const warnings = checkPasteCompatibility(result.tasks, context);
    if (warnings.length > 0) {
      showWarning(t('clipboard.compatibilityWarnings', {
        agentCount: warnings.filter((w) => w.kind === 'agent').length,
        workspaceCount: warnings.filter((w) => w.kind === 'workspace').length,
        connectorCount: warnings.filter((w) => w.kind === 'connector').length,
      }));
    }

    return result.pastedTaskIds;
  }, [captureSnapshot, getSelectedTaskNodes, playbook, selectStep, syncDataBindings, syncEdges, t, updateTasks]);

  return {
    nodes,
    edges,
    onNodesChange,
    onNodeDragStop,
    onEdgesChange,
    onConnect,
    onConnectStart: onConnectStartHandler,
    onConnectEnd: onConnectEndHandler,
    onNodeMouseEnter,
    onNodeMouseLeave,
    connectionDragHoveredId,
    addNode,
    removeNode,
    updateNodeData,
    setIteratorNodeSize,
    repackIteratorChildren,
    setNodes,
    setEdges,
    copySelection,
    cutSelection,
    pasteClipboard,
    triggerActions: playbook?.id ? triggerActions : undefined,
    artifactKindMismatch: pendingMismatch
      ? {
          open: true,
          sourcePortName: pendingMismatch.sourcePortName,
          sourceArtifactKind: pendingMismatch.sourceArtifactKind,
          targetPortName: pendingMismatch.targetPortName,
          targetArtifactKind: pendingMismatch.targetArtifactKind,
          canModifyPorts: true,
          onCreateCompatibleInput: resolveMismatchCreateCompatible,
          onUpdateExistingInput: resolveMismatchUpdateExisting,
          onCancel: dismissMismatch,
          onOpenChange: (open: boolean) => { if (!open) dismissMismatch(); },
        }
      : null,
  };
}
