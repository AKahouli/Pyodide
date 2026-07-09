import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { useAgentStore } from '../store';
import type { Agent } from '../types';
import type { UserAgentFormValues } from '../components/AgentFormSchema';
import { useModuleTranslation } from '@/modules/localization';

/**
 * Credentials surfaced in the A2A dialog after a publish or key rotation.
 * `rotated` distinguishes the two so the dialog can adjust its copy.
 */
export interface A2ADialogState {
  agent: Agent;
  agentCardUrl: string;
  apiKey: string;
  apiKeyHeader: string;
  rotated: boolean;
}

export interface UseAgentOperationsResult {
  editingAgent: Agent | null;
  viewingAgent: Agent | null;
  deletingAgent: Agent | null;
  sharingAgent: Agent | null;
  showCreateEditDialog: boolean;
  saving: boolean;
  duplicating: boolean;
  a2aResult: A2ADialogState | null;
  a2aProcessingId: string | null;
  revokingAgent: Agent | null;
  openCreate: () => void;
  openEdit: (agent: Agent) => void;
  openView: (agent: Agent) => void;
  setDeletingAgent: (agent: Agent | null) => void;
  setSharingAgent: (agent: Agent | null) => void;
  unshareAgent: (agent: Agent) => Promise<void>;
  setShowCreateEditDialog: (open: boolean) => void;
  setViewingAgent: (agent: Agent | null) => void;
  setA2aResult: (result: A2ADialogState | null) => void;
  setRevokingAgent: (agent: Agent | null) => void;
  handleSave: (data: UserAgentFormValues) => Promise<void>;
  confirmDelete: () => Promise<void>;
  duplicateAgent: (agent: Agent) => Promise<void>;
  publishOrRotateA2A: (agent: Agent) => Promise<void>;
  confirmRevokeA2A: () => Promise<void>;
}

export function useAgentOperations(): UseAgentOperationsResult {
  const {
    createAgent,
    updateAgent,
    deleteAgent,
    unshareAgent: unshareAgentInStore,
    publishAgentToA2A,
    rotateAgentA2AKey,
    revokeAgentA2A,
  } = useAgentStore();
  const { t } = useModuleTranslation('agent');

  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [sharingAgent, setSharingAgent] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [a2aResult, setA2aResult] = useState<A2ADialogState | null>(null);
  const [a2aProcessingId, setA2aProcessingId] = useState<string | null>(null);
  const [revokingAgent, setRevokingAgent] = useState<Agent | null>(null);

  const openCreate = useCallback(() => {
    setEditingAgent(null);
    setShowCreateEditDialog(true);
  }, []);

  const openEdit = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setShowCreateEditDialog(true);
  }, []);

  const openView = useCallback((agent: Agent) => {
    setViewingAgent(agent);
  }, []);

  const handleSave = useCallback(
    async (data: UserAgentFormValues) => {
      setSaving(true);
      try {
        const payload = {
          name: data.name,
          slug: data.slug,
          agentType: data.agentType,
          role: data.role,
          description: data.description,
          temperature: data.temperature,
          model: data.model || undefined,
          instruction: data.instruction,
          ignorePrePrompt: data.ignorePrePrompt,
          knowledgeBases: data.knowledgeBases,
          tools: data.tools,
          skills: data.skills,
          disabledSkills: data.disabledSkills,
          connectors: data.connectors,
          connectorActionSelections: data.connectorActionSelections,
          isActive: data.isActive,
          isDefaultForType: data.isDefaultForType,
          deploymentSettings: data.deploymentSettings,
        };
        if (editingAgent) {
          await updateAgent(editingAgent.id, payload);
        } else {
          await createAgent(payload);
        }
        setShowCreateEditDialog(false);
        setEditingAgent(null);
      } catch (err) {
        toast.error(
          editingAgent ? t('list.errors.updateFailed') : t('list.errors.createFailed'),
          {
            description: err instanceof Error ? err.message : t('list.errors.unknownError'),
          },
        );
      } finally {
        setSaving(false);
      }
    },
    [editingAgent, createAgent, updateAgent, t],
  );

  const confirmDelete = useCallback(async () => {
    if (!deletingAgent) return;
    try {
      await deleteAgent(deletingAgent.id);
      setDeletingAgent(null);
    } catch (err) {
      toast.error(t('list.errors.deleteFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    }
  }, [deletingAgent, deleteAgent, t]);

  const unshareAgent = useCallback(
    async (agent: Agent) => {
      try {
        await unshareAgentInStore(agent.id);
      } catch (err) {
        toast.error(t('share.errors.removeFailed'), {
          description: err instanceof Error ? err.message : t('list.errors.unknownError'),
        });
      }
    },
    [unshareAgentInStore, t],
  );

  const duplicateAgent = useCallback(
    async (agent: Agent) => {
      setDuplicating(true);
      try {
        const prefix = t('card.duplicatePrefix', { defaultValue: 'Copy of' }) as string;
        const rawName = `${prefix} ${agent.name}`.replace(/[^a-zA-Z0-9 ]/g, ' ');
        const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 50);
        const baseSlug = (agent.slug || agent.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slug = `${baseSlug}-copy-${Date.now().toString(36)}`.slice(0, 100);
        await createAgent({
          name: name || agent.name.slice(0, 47) + ' 2',
          slug,
          agentType: agent.agentType.id,
          role: agent.role,
          description: agent.description,
          temperature: agent.temperature,
          model: agent.model || undefined,
          instruction: agent.instruction,
          ignorePrePrompt: agent.ignorePrePrompt,
          knowledgeBases: agent.knowledgeBases,
          tools: agent.tools,
          skills: agent.skills,
          disabledSkills: agent.disabledSkills,
          connectors: agent.connectors,
          connectorActionSelections: agent.connectorActionSelections,
          isActive: agent.isActive,
          isDefaultForType: false,
          deploymentSettings: agent.deploymentSettings,
        });
      } catch (err) {
        toast.error(t('list.errors.createFailed'), {
          description: err instanceof Error ? err.message : t('list.errors.unknownError'),
        });
      } finally {
        setDuplicating(false);
      }
    },
    [createAgent, t],
  );

  const publishOrRotateA2A = useCallback(
    async (agent: Agent) => {
      setA2aProcessingId(agent.id);
      try {
        if (agent.a2aPublished) {
          const result = await rotateAgentA2AKey(agent.id);
          setA2aResult({
            agent,
            agentCardUrl: result.agentCardUrl,
            apiKey: result.apiKey,
            apiKeyHeader: result.apiKeyHeader,
            rotated: true,
          });
          toast.success(t('a2a.toasts.rotated', { defaultValue: 'A2A key rotated' }));
        } else {
          const result = await publishAgentToA2A(agent.id);
          setA2aResult({
            agent,
            agentCardUrl: result.agentCardUrl,
            apiKey: result.apiKey,
            apiKeyHeader: result.apiKeyHeader,
            rotated: false,
          });
          toast.success(t('a2a.toasts.published', { defaultValue: 'Agent published over A2A' }));
        }
      } catch (err) {
        toast.error(
          agent.a2aPublished
            ? t('a2a.errors.rotateFailed', { defaultValue: 'Failed to rotate A2A key' })
            : t('a2a.errors.publishFailed', { defaultValue: 'Failed to publish agent over A2A' }),
          {
            description: err instanceof Error ? err.message : t('list.errors.unknownError'),
          },
        );
      } finally {
        setA2aProcessingId(null);
      }
    },
    [publishAgentToA2A, rotateAgentA2AKey, t],
  );

  const confirmRevokeA2A = useCallback(async () => {
    if (!revokingAgent) return;
    const agent = revokingAgent;
    setA2aProcessingId(agent.id);
    try {
      await revokeAgentA2A(agent.id);
      setRevokingAgent(null);
      toast.success(t('a2a.toasts.revoked', { defaultValue: 'Agent revoked from A2A' }));
    } catch (err) {
      toast.error(t('a2a.errors.revokeFailed', { defaultValue: 'Failed to revoke agent' }), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setA2aProcessingId(null);
    }
  }, [revokingAgent, revokeAgentA2A, t]);

  return {
    editingAgent,
    viewingAgent,
    deletingAgent,
    sharingAgent,
    showCreateEditDialog,
    saving,
    duplicating,
    a2aResult,
    a2aProcessingId,
    revokingAgent,
    openCreate,
    openEdit,
    openView,
    setDeletingAgent,
    setSharingAgent,
    unshareAgent,
    setShowCreateEditDialog,
    setViewingAgent,
    setA2aResult,
    setRevokingAgent,
    handleSave,
    confirmDelete,
    duplicateAgent,
    publishOrRotateA2A,
    confirmRevokeA2A,
  };
}
