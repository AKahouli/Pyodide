import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { useAgentStore } from '../store';
import type { Agent } from '../types';
import type { UserAgentFormValues } from '../components/AgentFormSchema';
import { useModuleTranslation } from '@/modules/localization';

export interface UseAgentOperationsResult {
  editingAgent: Agent | null;
  viewingAgent: Agent | null;
  deletingAgent: Agent | null;
  showCreateEditDialog: boolean;
  saving: boolean;
  duplicating: boolean;
  openCreate: () => void;
  openEdit: (agent: Agent) => void;
  openView: (agent: Agent) => void;
  setDeletingAgent: (agent: Agent | null) => void;
  setShowCreateEditDialog: (open: boolean) => void;
  setViewingAgent: (agent: Agent | null) => void;
  handleSave: (data: UserAgentFormValues) => Promise<void>;
  confirmDelete: () => Promise<void>;
  duplicateAgent: (agent: Agent) => Promise<void>;
}

export function useAgentOperations(): UseAgentOperationsResult {
  const { createAgent, updateAgent, deleteAgent } = useAgentStore();
  const { t } = useModuleTranslation('agent');

  const [showCreateEditDialog, setShowCreateEditDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [viewingAgent, setViewingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

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
          isActive: data.isActive,
          isDefaultForType: data.isDefaultForType,
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
          isActive: agent.isActive,
          isDefaultForType: false,
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

  return {
    editingAgent,
    viewingAgent,
    deletingAgent,
    showCreateEditDialog,
    saving,
    duplicating,
    openCreate,
    openEdit,
    openView,
    setDeletingAgent,
    setShowCreateEditDialog,
    setViewingAgent,
    handleSave,
    confirmDelete,
    duplicateAgent,
  };
}
