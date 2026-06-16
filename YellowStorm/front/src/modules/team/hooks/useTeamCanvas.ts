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
  useReactFlow,
} from '@xyflow/react';
import { useTeamStore, useCurrentTeam } from '../store';
import { useAgentStore } from '@/modules/agent';
import type { TeamMember, TeamMemberWithAgent } from '../types';
import { wouldCreateCycle } from '../utils/cycle-detection';
import { autoLayoutMembers } from '../utils/auto-layout';
import { toast } from 'sonner';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import { getErrorMessage } from '@/lib/error-codes';

function tTeam(key: string, fallback: string) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'team', defaultValue: fallback });
  }
  return fallback;
}

export interface OrgChartNodeData extends Record<string, unknown> {
  agentId: string;
  parentAgentId: string | null;
  order: number;
  agentName: string;
  agentTypeName: string;
  agentRole: string;
  agentDescription: string;
  hasChildren: boolean;
}

export function membersToNodes(members: TeamMemberWithAgent[]): Node[] {
  const parentIds = new Set(
    members.filter((m) => m.parentAgentId).map((m) => m.parentAgentId!),
  );

  return members.map((m) => ({
    id: m.agentId,
    type: 'orgChartAgent',
    position: { x: m.positionX, y: m.positionY },
    data: {
      agentId: m.agentId,
      parentAgentId: m.parentAgentId,
      order: m.order,
      agentName: m.agent?.name || 'Unknown Agent',
      agentTypeName: m.agent?.agentType?.name || '',
      agentRole: m.agent?.role || '',
      agentDescription: m.agent?.description || '',
      hasChildren: parentIds.has(m.agentId),
    } satisfies OrgChartNodeData,
  }));
}

export function membersToEdges(members: TeamMemberWithAgent[]): Edge[] {
  return members
    .filter((m) => m.parentAgentId)
    .map((m) => ({
      id: `e-${m.parentAgentId}-${m.agentId}`,
      source: m.parentAgentId!,
      target: m.agentId,
      type: 'smoothstep',
    }));
}

function nodesToMembers(
  nodes: Node[],
  existingMembers: TeamMember[],
): TeamMember[] {
  const memberMap = new Map(existingMembers.map((m) => [m.agentId, m]));
  return nodes.map((node) => {
    const existing = memberMap.get(node.id);
    return {
      agentId: node.id,
      parentAgentId: existing?.parentAgentId ?? null,
      order: existing?.order ?? 0,
      positionX: node.position.x,
      positionY: node.position.y,
    };
  });
}

/** Look up agent data from the agent store for optimistic node rendering */
function getAgentInfo(agentId: string) {
  const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  return {
    id: agent.id,
    name: agent.name,
    agentType: agent.agentType,
    role: agent.role,
    description: agent.description,
  };
}

export function useTeamCanvas() {
  const currentTeam = useCurrentTeam();
  const updateHierarchy = useTeamStore((s) => s.updateHierarchy);
  const reactFlow = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;

  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;

  const syncedKeyRef = useRef<string | null>(null);
  const membersRef = useRef<TeamMember[]>([]);

  // Sync from store when team changes (initial load + after save)
  // Clear local state when currentTeam is null (team switch in progress)
  useEffect(() => {
    if (!currentTeam) {
      setNodes([]);
      setEdges([]);
      membersRef.current = [];
      syncedKeyRef.current = null;
      setIsDirty(false);
      return;
    }
    const syncKey = `${currentTeam.id}::${currentTeam.updatedAt}`;
    if (syncedKeyRef.current !== syncKey) {
      syncedKeyRef.current = syncKey;

      let members = currentTeam.members.map((m) => ({
        agentId: m.agentId,
        parentAgentId: m.parentAgentId,
        order: m.order,
        positionX: m.positionX,
        positionY: m.positionY,
      }));

      // Auto-layout if all positions are zero (freshly generated team)
      const needsLayout =
        members.length > 0 &&
        members.every((m) => m.positionX === 0 && m.positionY === 0);

      if (needsLayout) {
        members = autoLayoutMembers(members);
      }

      membersRef.current = members;

      // Rebuild nodes with agent data + computed positions.
      // Fall back to the agent store when the backend didn't populate `agent`.
      const agentMap = new Map(
        currentTeam.members.map((m) => [m.agentId, m.agent]),
      );
      const membersWithAgents: TeamMemberWithAgent[] = members.map((m) => ({
        ...m,
        agent: agentMap.get(m.agentId) ?? getAgentInfo(m.agentId),
      }));

      setNodes(membersToNodes(membersWithAgents));
      setEdges(membersToEdges(membersWithAgents));
      setIsDirty(needsLayout);
    }
  }, [currentTeam]);

  /** Mark local state as dirty (unsaved changes) */
  const markDirty = useCallback(() => setIsDirty(true), []);

  // ─── ReactFlow event handlers ───

  const onNodesChange: OnNodesChange = useCallback((changes) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onNodeDragStop: OnNodeDrag = useCallback(() => {
    // Sync positions from nodes into membersRef
    membersRef.current = nodesToMembers(nodesRef.current, membersRef.current);
    markDirty();
  }, [markDirty]);

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const hasStructuralChange = changes.some((c) => c.type !== 'select');

      setEdges((eds) => {
        const updated = applyEdgeChanges(changes, eds);

        if (hasStructuralChange) {
          // Rebuild parent relationships from remaining edges
          const edgeMap = new Map<string, string>();
          for (const e of updated) {
            edgeMap.set(e.target, e.source);
          }
          membersRef.current = membersRef.current.map((m) => ({
            ...m,
            parentAgentId: edgeMap.get(m.agentId) ?? null,
          }));
          markDirty();
        }

        return updated;
      });
    },
    [markDirty],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const source = connection.source;
      const target = connection.target;
      if (!source || !target) return;

      if (wouldCreateCycle(membersRef.current, target, source)) {
        toast.warning(
          tTeam('orgChart.cyclePrevented', 'Cannot create this relationship — it would cause a cycle.'),
        );
        return;
      }

      setEdges((eds) => {
        // An agent can have only one parent — remove any existing parent edge
        const filtered = eds.filter((e) => e.target !== target);
        const newEdge: Edge = {
          id: `e-${source}-${target}`,
          source,
          target,
          type: 'smoothstep',
        };
        const updated = addEdge(newEdge, filtered) as Edge[];

        membersRef.current = membersRef.current.map((m) =>
          m.agentId === target ? { ...m, parentAgentId: source } : m,
        );
        markDirty();

        return updated;
      });
    },
    [markDirty],
  );

  // ─── High-level actions (all local-only, mark dirty) ───

  const addMember = useCallback(
    (agentId: string) => {
      if (!currentTeam) return;
      if (membersRef.current.some((m) => m.agentId === agentId)) return;

      // Place at viewport center
      const canvasEl = document.querySelector('.react-flow');
      const w = canvasEl?.clientWidth ?? 800;
      const h = canvasEl?.clientHeight ?? 600;
      const center = reactFlow.screenToFlowPosition({ x: w / 2, y: h / 2 });

      const existingCount = nodesRef.current.length;
      const newMember: TeamMember = {
        agentId,
        parentAgentId: null,
        order: existingCount,
        positionX: center.x - 140,
        positionY: center.y - 60,
      };

      membersRef.current = [...membersRef.current, newMember];

      // Optimistic local node using agent store data
      const agentInfo = getAgentInfo(agentId);
      const newNode: Node = {
        id: agentId,
        type: 'orgChartAgent',
        position: { x: newMember.positionX, y: newMember.positionY },
        data: {
          agentId,
          parentAgentId: null,
          order: newMember.order,
          agentName: agentInfo?.name || 'Unknown Agent',
          agentTypeName: agentInfo?.agentType?.name || '',
          agentRole: agentInfo?.role || '',
          agentDescription: agentInfo?.description || '',
          hasChildren: false,
        } satisfies OrgChartNodeData,
      };
      setNodes((prev) => [...prev, newNode]);
      markDirty();
    },
    [currentTeam, markDirty, reactFlow],
  );

  const removeMember = useCallback(
    (agentId: string) => {
      if (!currentTeam) return;

      // Orphan children to root
      membersRef.current = membersRef.current
        .filter((m) => m.agentId !== agentId)
        .map((m) => ({
          ...m,
          parentAgentId: m.parentAgentId === agentId ? null : m.parentAgentId,
        }));

      setNodes((nds) => nds.filter((n) => n.id !== agentId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== agentId && e.target !== agentId),
      );
      markDirty();
    },
    [currentTeam, markDirty],
  );

  const setMemberAsRoot = useCallback(
    (agentId: string) => {
      if (!currentTeam) return;

      // Update member: clear parent
      membersRef.current = membersRef.current.map((m) =>
        m.agentId === agentId ? { ...m, parentAgentId: null } : m,
      );

      // Rebuild nodes and edges from updated members to ensure full consistency
      const agentMap = new Map(
        currentTeam.members.map((m) => [m.agentId, m.agent]),
      );
      const membersWithAgents: TeamMemberWithAgent[] = membersRef.current.map((m) => ({
        ...m,
        agent: agentMap.get(m.agentId) ?? getAgentInfo(m.agentId),
      }));

      setNodes(membersToNodes(membersWithAgents));
      setEdges(membersToEdges(membersWithAgents));
      markDirty();
    },
    [currentTeam, markDirty],
  );

  const autoLayout = useCallback(() => {
    if (!currentTeam || membersRef.current.length === 0) return;

    const layouted = autoLayoutMembers(membersRef.current);
    membersRef.current = layouted;

    // Rebuild nodes with agent data from current team
    const agentMap = new Map(
      currentTeam.members.map((m) => [m.agentId, m.agent]),
    );
    // Fall back to agent store for members added since last save
    const layoutedWithAgents: TeamMemberWithAgent[] = layouted.map((m) => ({
      ...m,
      agent: agentMap.get(m.agentId) ?? getAgentInfo(m.agentId),
    }));

    setNodes(membersToNodes(layoutedWithAgents));
    setEdges(membersToEdges(layoutedWithAgents));
    markDirty();

    setTimeout(() => reactFlow.fitView({ padding: 0.2 }), 100);
  }, [currentTeam, markDirty, reactFlow]);

  // ─── Save: persist current local state to API ───

  const save = useCallback(async () => {
    if (!currentTeam || !isDirty) return;
    setIsSaving(true);
    try {
      // Sync latest positions from nodes into membersRef before saving
      membersRef.current = nodesToMembers(nodesRef.current, membersRef.current);
      await updateHierarchy(currentTeam.id, { members: membersRef.current });
      // Store re-fetches and updates currentTeam → sync effect resets isDirty
      toast.success(
        tTeam('store.toasts.hierarchySaved', 'Hierarchy saved'),
        { description: tTeam('store.toasts.hierarchySavedDescription', 'Team hierarchy has been updated.') },
      );
    } catch (err) {
      const apiErr = err as { code?: string };
      toast.error(tTeam('orgChart.saveFailed', 'Failed to save hierarchy.'), {
        description: apiErr?.code ? getErrorMessage(apiErr.code) : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }, [currentTeam, isDirty, updateHierarchy]);

  // ─── Revert: discard local changes, restore from last saved state ───

  const revert = useCallback(() => {
    if (!currentTeam || !isDirty) return;
    // Reset syncedKey so the sync effect re-applies currentTeam data
    syncedKeyRef.current = null;

    let members = currentTeam.members.map((m) => ({
      agentId: m.agentId,
      parentAgentId: m.parentAgentId,
      order: m.order,
      positionX: m.positionX,
      positionY: m.positionY,
    }));

    const needsLayout =
      members.length > 0 &&
      members.every((m) => m.positionX === 0 && m.positionY === 0);
    if (needsLayout) {
      members = autoLayoutMembers(members);
    }

    membersRef.current = members;

    const agentMap = new Map(
      currentTeam.members.map((m) => [m.agentId, m.agent]),
    );
    const membersWithAgents: TeamMemberWithAgent[] = members.map((m) => ({
      ...m,
      agent: agentMap.get(m.agentId) ?? getAgentInfo(m.agentId),
    }));

    setNodes(membersToNodes(membersWithAgents));
    setEdges(membersToEdges(membersWithAgents));
    syncedKeyRef.current = `${currentTeam.id}::${currentTeam.updatedAt}`;
    setIsDirty(false);
  }, [currentTeam, isDirty]);

  return {
    nodes,
    edges,
    isDirty,
    isSaving,
    onNodesChange,
    onNodeDragStop,
    onEdgesChange,
    onConnect,
    addMember,
    removeMember,
    setMemberAsRoot,
    autoLayout,
    save,
    revert,
  };
}
