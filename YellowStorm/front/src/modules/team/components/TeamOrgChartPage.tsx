import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider, type NodeMouseHandler } from '@xyflow/react';
import { ArrowLeft, LayoutGrid, Loader2, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import { Canvas } from '@/components/ai-elements/canvas';
import { Controls } from '@/components/ai-elements/controls';
import { useTeamStore, useCurrentTeam, useCurrentTeamLoading, useIsGenerating } from '../store';
import { useTeamCanvas } from '../hooks/useTeamCanvas';
import { OrgChartNode } from './OrgChartNode';
import { AddMemberPopover } from './AddMemberPopover';
import { PlaybookGeneratingOverlay } from '@/modules/playbook/components/PlaybookGeneratingOverlay';
import { useAgentStore, useAgentById } from '@/modules/agent';
import { CreateEditAgentDialog } from '@/modules/agent/components/CreateEditAgentDialog';
import type { UserAgentFormValues } from '@/modules/agent/components/AgentFormSchema';
import type { Agent } from '@/modules/agent';
import { useModuleTranslation } from '@/modules/localization';

function TeamOrgChartInner() {
  const { id } = useParams<{ id: string }>();
  const isGeneratingRoute = id === 'generating';
  const navigate = useNavigate();
  const { t } = useModuleTranslation('team');

  const fetchTeamById = useTeamStore((s) => s.fetchTeamById);
  const currentTeam = useCurrentTeam();
  const currentTeamLoading = useCurrentTeamLoading();
  const isGenerating = useIsGenerating();

  const {
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
  } = useTeamCanvas();

  const nodeTypes = useMemo(() => ({ orgChartAgent: OrgChartNode }), []);

  // Agent edit dialog state
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const editingAgent = useAgentById(editingAgentId || '');

  // Fetch team + agents on mount (skip for the generating route)
  useEffect(() => {
    if (id && !isGeneratingRoute) {
      fetchTeamById(id);
    }
    useAgentStore.getState().fetchAgents();
  }, [id, isGeneratingRoute, fetchTeamById]);

  // When generation completes, redirect to the real team URL
  useEffect(() => {
    if (!isGeneratingRoute) return;
    const unsubscribe = useTeamStore.subscribe((state, prevState) => {
      if (prevState.isGenerating && !state.isGenerating && state.currentTeam) {
        navigate(`/teams/${state.currentTeam.id}`, { replace: true });
      }
    });
    return unsubscribe;
  }, [isGeneratingRoute, navigate]);

  // Listen for context menu events dispatched from OrgChartNode
  useEffect(() => {
    const handleRemove = (e: Event) => {
      removeMember((e as CustomEvent).detail.agentId);
    };
    const handleSetRoot = (e: Event) => {
      setMemberAsRoot((e as CustomEvent).detail.agentId);
    };

    window.addEventListener('team:remove-member', handleRemove);
    window.addEventListener('team:set-root', handleSetRoot);
    return () => {
      window.removeEventListener('team:remove-member', handleRemove);
      window.removeEventListener('team:set-root', handleSetRoot);
    };
  }, [removeMember, setMemberAsRoot]);

  // Double-click on node → open agent edit dialog. Only owned, non-default
  // personal agents are editable; others fall through with an info toast.
  const handleNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    const agent = useAgentStore.getState().agents.find((a) => a.id === node.id);
    if (!agent) {
      toast.info(t('orgChart.agentNotEditable'));
      return;
    }
    if (agent.isDefault) {
      toast.info(t('orgChart.defaultAgentReadonly'));
      return;
    }
    setEditingAgentId(node.id);
    setAgentDialogOpen(true);
  }, [t]);

  const handleAgentSave = useCallback(async (data: UserAgentFormValues) => {
    if (!editingAgentId) return;
    setAgentSaving(true);
    try {
      await useAgentStore.getState().updateAgent(editingAgentId, data);
      setAgentDialogOpen(false);
      setEditingAgentId(null);
      if (id) fetchTeamById(id);
    } catch {
      // Agent store toasts on success; errors are shown by the store
    } finally {
      setAgentSaving(false);
    }
  }, [editingAgentId, id, fetchTeamById]);

  // ─── Generating state: overlay on a blank canvas ───
  if (isGeneratingRoute || isGenerating) {
    return (
      <div className='relative flex flex-col h-full w-full'>
        <div className='flex items-center gap-3 px-4 py-3 border-b bg-background z-10'>
          <Button variant='ghost' size='icon' onClick={() => navigate('/teams')}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div className='h-5 w-40 rounded bg-muted animate-pulse' />
        </div>
        <div className='flex-1 bg-muted/20' />
        <PlaybookGeneratingOverlay
          title={t('orgChart.generatingTitle')}
          subtitle={t('orgChart.generatingSubtitle')}
        />
      </div>
    );
  }

  // ─── Loading state ───
  if (currentTeamLoading || !currentTeam) {
    return (
      <div className='flex items-center justify-center h-full w-full'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  // ─── Permission check ───
  const isSharedReadOnly = !!currentTeam.shareInfo && currentTeam.shareInfo.permission === 'read';
  const canModify = !isSharedReadOnly;

  // ─── Canvas ───
  return (
    <div className='flex flex-col h-full w-full'>
      {/* Header */}
      <div className='flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0'>
        <Button variant='ghost' size='icon' onClick={() => navigate('/teams')}>
          <ArrowLeft className='h-4 w-4' />
        </Button>
        <div className='flex-1 min-w-0'>
          <h1 className='text-lg font-semibold truncate'>{currentTeam.name}</h1>
          {currentTeam.description && (
            <p className='text-xs text-muted-foreground truncate'>
              {currentTeam.description}
            </p>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {isSharedReadOnly && (
            <span className='text-xs text-muted-foreground bg-muted px-2 py-1 rounded'>
              {t('orgChart.readOnly')}
            </span>
          )}
          <Button size='sm' variant='outline' onClick={autoLayout} disabled={nodes.length === 0}>
            <LayoutGrid className='mr-1 h-4 w-4' />
            {t('orgChart.autoLayout')}
          </Button>
          {canModify && (
            <>
              <AddMemberPopover
                existingAgentIds={nodes.map((n) => n.id)}
                onAdd={addMember}
              />
              <Button size='sm' variant='outline' onClick={revert} disabled={!isDirty || isSaving}>
                <Undo2 className='mr-1 h-4 w-4' />
                {t('orgChart.revert')}
              </Button>
              <Button size='sm' onClick={save} disabled={!isDirty || isSaving}>
                {isSaving ? (
                  <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                ) : (
                  <Save className='mr-1 h-4 w-4' />
                )}
                {isSaving ? t('orgChart.saving') : t('orgChart.save')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className='flex-1 min-h-0 relative'>
        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={canModify ? onNodesChange : undefined}
          onNodeDragStop={canModify ? onNodeDragStop : undefined}
          onEdgesChange={canModify ? onEdgesChange : undefined}
          onConnect={canModify ? onConnect : undefined}
          onNodeDoubleClick={canModify ? handleNodeDoubleClick : undefined}
          nodeTypes={nodeTypes}
          panOnDrag={true}
          panOnScroll={false}
          zoomOnScroll={true}
          fitView={true}
          nodesDraggable={canModify}
          nodesConnectable={canModify}
          elementsSelectable={true}
        >
          <Controls />
        </Canvas>

        {nodes.length === 0 && (
          <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
            <p className='text-muted-foreground bg-background/80 px-4 py-2 rounded-md'>
              {t('orgChart.emptyState')}
            </p>
          </div>
        )}
      </div>

      {/* Agent edit dialog */}
      <CreateEditAgentDialog
        open={agentDialogOpen}
        onOpenChange={(open) => {
          setAgentDialogOpen(open);
          if (!open) setEditingAgentId(null);
        }}
        agent={(editingAgent as Agent) ?? null}
        onSave={handleAgentSave}
        saving={agentSaving}
      />
    </div>
  );
}

export function TeamOrgChartPage() {
  return (
    <ReactFlowProvider>
      <TeamOrgChartInner />
    </ReactFlowProvider>
  );
}
