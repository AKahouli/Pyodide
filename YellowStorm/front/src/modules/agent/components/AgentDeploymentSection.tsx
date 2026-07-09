import { useCallback, useEffect, useMemo, useState } from "react";

import { Sparkles } from "lucide-react";



import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";

import { Switch } from "@/components/ui/switch";

import { API_CONFIG } from "@/lib/api/config";
import { cn } from "@/lib/utils";

import { showSuccess, showWarning } from "@/lib/notifications";

import { useModuleTranslation } from "@/modules/localization";

import { buildWidgetSnippet } from "../constants/widget-template";

import {

  buildAgentIntegrationRestSpec,

  isIntegrationRestSpec,

  type IntegrationRestSpec,

} from "../constants/agent-integration-rest";

import { createWidgetToken } from "@/modules/agent/api";

import { WidgetRestApiPanel } from "./WidgetRestApiPanel";

import { IntegrationSnippetPanel } from "./IntegrationSnippetPanel";



function getApiBase(): string {
  return API_CONFIG.baseURL.replace(/\/$/, "");
}



interface AgentDeploymentSectionProps {

  agentId: string | null;

  agentName?: string;

  value: { embedEnabled: boolean; restEnabled: boolean };

  onChange: (value: { embedEnabled: boolean; restEnabled: boolean }) => void;

}



export function AgentDeploymentSection({ agentId, agentName = "", value, onChange }: AgentDeploymentSectionProps) {

  const { t } = useModuleTranslation("agent");

  const [embedSnippet, setEmbedSnippet] = useState("");

  const [restSpec, setRestSpec] = useState<IntegrationRestSpec | null>(null);

  const [isCopied, setIsCopied] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);

  const isEmbedEnabled = value.embedEnabled;

  const isRestEnabled = value.restEnabled;



  const applyGenerated = useCallback(

    (id: string, name: string, token: string) => {

      const apiBase = getApiBase();

      setEmbedSnippet(

        buildWidgetSnippet(id, name, token, `${apiBase}/widget/chat`, `${apiBase}/widget/stream`),

      );

      setRestSpec(buildAgentIntegrationRestSpec(apiBase, id, token));

    },

    [],

  );



  useEffect(() => {

    if (!agentId) {

      setEmbedSnippet("");

      setRestSpec(null);

    }

  }, [agentId]);

  const setEmbedEnabled = (embedEnabled: boolean) => onChange({ ...value, embedEnabled });

  const setRestEnabled = (restEnabled: boolean) => onChange({ ...value, restEnabled });



  const hasEmbed = embedSnippet.trim().length > 0;

  const hasRest = isIntegrationRestSpec(restSpec);

  const embedLines = useMemo(() => (hasEmbed ? embedSnippet.split("\n") : []), [embedSnippet, hasEmbed]);



  const handleGenerate = async () => {

    if (!agentId) {

      showWarning(t("createEdit.fields.deploymentRequiresAgent"));

      return;

    }

    setIsGenerating(true);

    try {

      const result = await createWidgetToken(agentId);

      applyGenerated(agentId, agentName, result.token);

      setIsCopied(false);

      showSuccess(t("createEdit.fields.deploymentGenerated"));

    } catch {

      showWarning(t("createEdit.fields.deploymentGenerateFailed"));

    } finally {

      setIsGenerating(false);

    }

  };



  const handleCopyEmbed = async () => {

    if (!hasEmbed) return;

    try {

      await navigator.clipboard.writeText(embedSnippet);

      setIsCopied(true);

      showSuccess(t("createEdit.fields.deploymentSnippetCopied"));

      window.setTimeout(() => setIsCopied(false), 2000);

    } catch {

      showWarning(t("createEdit.fields.deploymentCopyFailed"));

    }

  };



  return (

    <div className="grid min-w-0 max-w-full gap-4">

      <div className="space-y-2">

        <Label>{t("createEdit.fields.deployment")}</Label>

        <p className="text-xs text-muted-foreground">{t("createEdit.fields.deploymentDescription")}</p>

      </div>



      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={cn(
            "space-y-3 rounded-md border p-4",
            isEmbedEnabled ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("createEdit.fields.deploymentModeEmbed")}</p>
              <p className="text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeEmbedHint")}</p>
            </div>
            <Switch
              data-testid="embed-deployment-switch"
              aria-label={t("createEdit.fields.deploymentModeEmbed")}
              checked={isEmbedEnabled}
              disabled={!agentId || isGenerating}
              onCheckedChange={setEmbedEnabled}
            />
          </div>

          {isEmbedEnabled && !agentId && (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              {t("createEdit.fields.deploymentRequiresAgent")}
            </p>
          )}

          {isEmbedEnabled && agentId && (
            <Button type="button" size="sm" onClick={() => void handleGenerate()} disabled={isGenerating}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t("createEdit.actions.generateDeploymentSnippet")}
            </Button>
          )}
        </div>

        <div
          className={cn(
            "space-y-3 rounded-md border p-4",
            isRestEnabled ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("createEdit.fields.deploymentModeRest")}</p>
              <p className="text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeRestHint")}</p>
            </div>
            <Switch
              data-testid="rest-deployment-switch"
              aria-label={t("createEdit.fields.deploymentModeRest")}
              checked={isRestEnabled}
              disabled={!agentId || isGenerating}
              onCheckedChange={setRestEnabled}
            />
          </div>

          {isRestEnabled && !agentId && (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              {t("createEdit.fields.deploymentRequiresAgent")}
            </p>
          )}

          {isRestEnabled && agentId && (
            <Button type="button" size="sm" onClick={() => void handleGenerate()} disabled={isGenerating}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t("createEdit.actions.generateDeploymentSnippet")}
            </Button>
          )}
        </div>
      </div>

      {isEmbedEnabled && hasEmbed && (
        <IntegrationSnippetPanel
          title={t("createEdit.fields.deploymentSnippet")}
          hint={t("createEdit.fields.deploymentSnippetHint")}
          badge="HTML"
          lines={embedLines}
          isCopied={isCopied}
          copyLabel={t("createEdit.actions.copyDeploymentSnippet")}
          copiedLabel={t("createEdit.actions.deploymentSnippetCopiedShort")}
          onCopy={() => void handleCopyEmbed()}
        />
      )}

      {isRestEnabled && hasRest && restSpec && <WidgetRestApiPanel spec={restSpec} />}

    </div>

  );

}


