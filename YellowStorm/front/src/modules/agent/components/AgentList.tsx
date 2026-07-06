import { useEffect, useState } from "react";
import { Plus, Loader2, Bot } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useAgentStore, usePersonalAgents, useDefaultAgents, useAgentsLoading } from "../store";
import { AgentCard } from "./AgentCard";
import { CreateEditAgentDialog } from "./CreateEditAgentDialog";
import type { Agent } from "../types";
import type { UserAgentFormValues } from "./AgentFormSchema";
import { useModuleTranslation } from "@/modules/localization";

export function AgentList() {
  const personalAgents = usePersonalAgents();
  const defaultAgents = useDefaultAgents();
  const isLoading = useAgentsLoading();
  const { fetchAgents, fetchAgentTypes, createAgent, updateAgent, deleteAgent } = useAgentStore();
  const { t } = useModuleTranslation('agent');

  const [showDialog, setShowDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAgents();
    fetchAgentTypes();
  }, [fetchAgents, fetchAgentTypes]);

  const handleSave = async (data: UserAgentFormValues) => {
    setSaving(true);
    try {
      if (editingAgent) {
        await updateAgent(editingAgent.id, {
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
          deploymentSettings: data.deploymentSettings,
          isActive: data.isActive,
          isDefaultForType: data.isDefaultForType,
        });
      } else {
        await createAgent({
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
          deploymentSettings: data.deploymentSettings,
          isActive: data.isActive,
          isDefaultForType: data.isDefaultForType,
        });
      }
      setShowDialog(false);
      setEditingAgent(null);
    } catch (err) {
      toast.error(editingAgent ? t('list.errors.updateFailed') : t('list.errors.createFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingAgent) return;
    try {
      await deleteAgent(deletingAgent.id);
      setDeletingAgent(null);
    } catch (err) {
      toast.error(t('list.errors.deleteFailed'), {
        description: err instanceof Error ? err.message : t('list.errors.unknownError'),
      });
    }
  };

  const openCreate = () => {
    setEditingAgent(null);
    setShowDialog(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setShowDialog(true);
  };

  if (isLoading && personalAgents.length === 0 && defaultAgents.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <h3 className="font-semibold">{t('list.heading')}</h3>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t('list.newAgent')}
        </Button>
      </div>

      {/* My Agents */}
      {personalAgents.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">{t('list.myAgents')}</h4>
          <div className="space-y-2">
            {personalAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={openEdit}
                onDelete={setDeletingAgent}
              />
            ))}
          </div>
        </div>
      )}

      {/* Default Agents */}
      {defaultAgents.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">{t('list.defaultAgents')}</h4>
          <div className="space-y-2">
            {defaultAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {personalAgents.length === 0 && defaultAgents.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {t('list.emptyState')}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <CreateEditAgentDialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) setEditingAgent(null);
        }}
        agent={editingAgent}
        onSave={handleSave}
        saving={saving}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingAgent}
        onOpenChange={(open) => {
          if (!open) setDeletingAgent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('list.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('list.deleteDialog.descriptionStart')}{" "}
              <strong>{deletingAgent?.name}</strong>{t('list.deleteDialog.descriptionEnd')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('list.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('list.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
