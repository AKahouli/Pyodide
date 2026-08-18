import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showError, showSuccess } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { getCopilotAssistantAgents, getCopilotAssistantSettings, updateCopilotAssistantSettings } from "../api";
import { usePermissions } from "../hooks/usePermissions";
import type { CopilotAssistantAgentOption } from "../types";

export function CopilotAssistantCard() {
  const { t } = useModuleTranslation("admin");
  const { hasPermission } = usePermissions();

  const canManage = hasPermission("system.*") || hasPermission("*");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<CopilotAssistantAgentOption[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, agentOptions] = await Promise.all([
        getCopilotAssistantSettings(),
        getCopilotAssistantAgents(),
      ]);
      setAgentId(settings.agentId);
      setAgents(agentOptions);
    } catch (error) {
      showError(t("system.copilotAssistant.toasts.error.title"), {
        description: error instanceof Error ? error.message : t("system.copilotAssistant.toasts.error.description"),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) || null,
    [agents, agentId],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateCopilotAssistantSettings({ agentId });
      setAgentId(result.agentId);
      showSuccess(t("system.copilotAssistant.toasts.saved.title"), {
        description: t("system.copilotAssistant.toasts.saved.description"),
      });
    } catch (error) {
      showError(t("system.copilotAssistant.toasts.error.title"), {
        description: error instanceof Error ? error.message : t("system.copilotAssistant.toasts.error.description"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>{t("system.copilotAssistant.card.title")}</CardTitle>
            <CardDescription>
              {t("system.copilotAssistant.card.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="copilot-assistant-agent">{t("system.copilotAssistant.agent.label")}</Label>
              <Select
                value={agentId ?? ""}
                onValueChange={setAgentId}
                disabled={!canManage || agents.length === 0}
              >
                <SelectTrigger id="copilot-assistant-agent">
                  <SelectValue placeholder={t("system.copilotAssistant.agent.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {agentId && !selectedAgent && (
                    <SelectItem value={agentId} disabled>
                      {t("system.copilotAssistant.agent.unavailable")}
                    </SelectItem>
                  )}
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.model ? ` · ${agent.model}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className={selectedAgent ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                {selectedAgent
                  ? t("system.copilotAssistant.agent.selectedHelp", {
                    agent: selectedAgent.name,
                    model: selectedAgent.model || "-",
                  })
                  : agents.length === 0
                    ? t("system.copilotAssistant.agent.noOptions")
                    : t("system.copilotAssistant.agent.required")}
              </p>
            </div>
            {canManage && (
              <div className="flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving || loading}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t("system.copilotAssistant.actions.save")}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
