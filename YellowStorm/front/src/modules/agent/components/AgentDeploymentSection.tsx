import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

type DeploymentMode = "embed" | "rest";

function getApiBase(): string {
  return (import.meta.env.VITE_API_URL || "http://localhost:3000/api/v1").replace(/\/$/, "");
}

interface AgentDeploymentSectionProps {
  agentId: string | null;
  agentName?: string;
}

export function AgentDeploymentSection({ agentId, agentName = "" }: AgentDeploymentSectionProps) {
  const { t } = useModuleTranslation("agent");
  const [mode, setMode] = useState<DeploymentMode>("embed");
  const [embedSnippet, setEmbedSnippet] = useState("");
  const [restSpec, setRestSpec] = useState<IntegrationRestSpec | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

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

      <RadioGroup
        value={mode}
        onValueChange={(v) => setMode(v as DeploymentMode)}
        className="grid gap-2 sm:grid-cols-2"
      >
        <label
          htmlFor="deploy-embed"
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
            mode === "embed" ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <RadioGroupItem value="embed" id="deploy-embed" className="mt-0.5" />
          <div>
            <p className="text-sm font-medium">{t("createEdit.fields.deploymentModeEmbed")}</p>
            <p className="text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeEmbedHint")}</p>
          </div>
        </label>
        <label
          htmlFor="deploy-rest"
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
            mode === "rest" ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <RadioGroupItem value="rest" id="deploy-rest" className="mt-0.5" />
          <div>
            <p className="text-sm font-medium">{t("createEdit.fields.deploymentModeRest")}</p>
            <p className="text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeRestHint")}</p>
          </div>
        </label>
      </RadioGroup>

      {!agentId ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          {t("createEdit.fields.deploymentRequiresAgent")}
        </p>
      ) : (
        <Button type="button" size="sm" onClick={() => void handleGenerate()} disabled={isGenerating}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {t("createEdit.actions.generateDeploymentSnippet")}
        </Button>
      )}

      {mode === "embed" && hasEmbed && (
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

      {mode === "rest" && hasRest && restSpec && <WidgetRestApiPanel spec={restSpec} />}
    </div>
  );
}
