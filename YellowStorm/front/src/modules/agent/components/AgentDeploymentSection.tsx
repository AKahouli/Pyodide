import { useCallback, useEffect, useMemo, useState } from "react";

import { ChevronDown, Sparkles } from "lucide-react";



import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Label } from "@/components/ui/label";

import { Switch } from "@/components/ui/switch";

import { API_CONFIG } from "@/lib/api/config";
import { cn } from "@/lib/utils";

import { showSuccess, showWarning } from "@/lib/notifications";

import { useModuleTranslation } from "@/modules/localization";

import { buildWidgetCdnSnippet } from "../constants/widget-template";
import {

  buildAgentIntegrationRestSpec,

  isIntegrationRestSpec,

  type IntegrationRestSpec,

} from "../constants/agent-integration-rest";

import { createWidgetToken } from "@/modules/agent/api";

import { WidgetRestApiPanel } from "./WidgetRestApiPanel";

import { IntegrationSnippetPanel } from "./IntegrationSnippetPanel";
import { WidgetSettingsPane } from './deployment/WidgetSettingsPane';
import { DEFAULT_WIDGET_SETTINGS, mergeWidgetSettings } from '../constants/widget-default-settings';
import type { AgentDeploymentSettings } from '../types';



function getApiBase(): string {
  return API_CONFIG.baseURL.replace(/\/$/, "");
}

/** Origin that hosts `/widget-embed.js` (YellowStorm web app / CDN). */
function getWidgetCdnBase(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  const fromEnv = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, "");
  return fromEnv || "http://localhost:5173";
}



interface AgentDeploymentSectionProps {

  agentId: string | null;

  agentName?: string;

  value: AgentDeploymentSettings;

  onChange: (value: AgentDeploymentSettings) => void;

  readOnly?: boolean;


}



export function AgentDeploymentSection({ agentId, agentName = "", value, onChange, readOnly = false }: AgentDeploymentSectionProps) {

  const { t } = useModuleTranslation("agent");

  const [embedSnippet, setEmbedSnippet] = useState("");

  const [restSpec, setRestSpec] = useState<IntegrationRestSpec | null>(null);

  const [isCopied, setIsCopied] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isEmbedDialogOpen, setIsEmbedDialogOpen] = useState(false);

  const [openPanes, setOpenPanes] = useState<ReadonlyArray<"embed" | "rest">>([]);

  const isEmbedEnabled = value.embedEnabled;

  const isRestEnabled = value.restEnabled;



  const applyGenerated = useCallback(

    (id: string, name: string, token: string) => {

      const apiBase = getApiBase();

      setEmbedSnippet(
        buildWidgetCdnSnippet({
          embedHandle: token,
          cdnBaseUrl: getWidgetCdnBase(),
        }),
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

  const widgetSettings = mergeWidgetSettings(value.widget ?? DEFAULT_WIDGET_SETTINGS);

  const setEmbedEnabled = (embedEnabled: boolean) => {
    if (readOnly) return;
    onChange({ ...value, widget: widgetSettings, embedEnabled });
  };

  const setRestEnabled = (restEnabled: boolean) => {
    if (readOnly) return;
    onChange({ ...value, widget: widgetSettings, restEnabled });
  };

  const isPaneOpen = (pane: "embed" | "rest") => openPanes.includes(pane);

  const togglePane = (pane: "embed" | "rest") => {
    setOpenPanes((current) => (current.includes(pane) ? current.filter((item) => item !== pane) : [...current, pane]));
  };



  const hasEmbed = embedSnippet.trim().length > 0;

  const hasRest = isIntegrationRestSpec(restSpec);

  const embedLines = useMemo(() => (hasEmbed ? embedSnippet.split("\n") : []), [embedSnippet, hasEmbed]);



  const handleGenerate = async (mode: "embed" | "rest") => {

    if (readOnly || !agentId) {

      showWarning(t("createEdit.fields.deploymentRequiresAgent"));

      return;

    }

    setIsGenerating(true);

    try {

       const result = await createWidgetToken(agentId);

       applyGenerated(agentId, agentName, result.token);

       setIsCopied(false);

       if (mode === "embed") setIsEmbedDialogOpen(true);

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



      <div className="grid gap-3">
        <div
          className={cn(
            "rounded-md border",
            isEmbedEnabled ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="flex items-start justify-between gap-4 p-4">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
              aria-expanded={isPaneOpen("embed")}
              onClick={() => togglePane("embed")}
            >
              <span className="space-y-1">
                <span className="block text-sm font-medium">{t("createEdit.fields.deploymentModeEmbed")}</span>
                <span className="block text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeEmbedHint")}</span>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isPaneOpen("embed") && "rotate-180")} />
            </button>
            <Switch
              data-testid="embed-deployment-switch"
              aria-label={t("createEdit.fields.deploymentModeEmbed")}
              checked={isEmbedEnabled}
              disabled={!agentId || isGenerating}
              onCheckedChange={setEmbedEnabled}
            />
          </div>

          {isPaneOpen("embed") && (
            <div className="space-y-3 border-t px-4 pb-4 pt-3">
              {isEmbedEnabled && !agentId && (
                <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  {t("createEdit.fields.deploymentRequiresAgent")}
                </p>
              )}

              {isEmbedEnabled && agentId && (
                <Button type="button" size="sm" onClick={() => void handleGenerate("embed")} disabled={readOnly || isGenerating}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {t("createEdit.actions.generateDeploymentSnippet")}
                </Button>
              )}

              {isEmbedEnabled && (
                <WidgetSettingsPane value={widgetSettings} onChange={(widget) => onChange({ ...value, widget })} />
              )}

            </div>
          )}
        </div>

        <div
          className={cn(
            "rounded-md border",
            isRestEnabled ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="flex items-start justify-between gap-4 p-4">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
              aria-expanded={isPaneOpen("rest")}
              onClick={() => togglePane("rest")}
            >
              <span className="space-y-1">
                <span className="block text-sm font-medium">{t("createEdit.fields.deploymentModeRest")}</span>
                <span className="block text-xs text-muted-foreground">{t("createEdit.fields.deploymentModeRestHint")}</span>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isPaneOpen("rest") && "rotate-180")} />
            </button>
            <Switch
              data-testid="rest-deployment-switch"
              aria-label={t("createEdit.fields.deploymentModeRest")}
              checked={isRestEnabled}
              disabled={!agentId || isGenerating}
              onCheckedChange={setRestEnabled}
            />
          </div>

          {isPaneOpen("rest") && (
            <div className="space-y-3 border-t px-4 pb-4 pt-3">
              {isRestEnabled && !agentId && (
                <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  {t("createEdit.fields.deploymentRequiresAgent")}
                </p>
              )}

              {isRestEnabled && agentId && (
                <Button type="button" size="sm" onClick={() => void handleGenerate("rest")} disabled={readOnly || isGenerating}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {t("createEdit.actions.generateDeploymentSnippet")}
                </Button>
              )}

              {isRestEnabled && hasRest && restSpec && <WidgetRestApiPanel spec={restSpec} />}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isEmbedDialogOpen} onOpenChange={setIsEmbedDialogOpen}>
        <DialogContent className="max-w-xl gap-4 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("createEdit.fields.deploymentSnippet")}</DialogTitle>
            <DialogDescription>{t("createEdit.fields.deploymentSnippetDialogDescription")}</DialogDescription>
          </DialogHeader>
          {hasEmbed && (
            <IntegrationSnippetPanel
              title={t("createEdit.fields.deploymentSnippet")}
              hint={t("createEdit.fields.deploymentSnippetHint")}
              badge="HTML"
              lines={embedLines}
              compact
              isCopied={isCopied}
              copyLabel={t("createEdit.actions.copyDeploymentSnippet")}
              copiedLabel={t("createEdit.actions.deploymentSnippetCopiedShort")}
              onCopy={() => void handleCopyEmbed()}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>

  );

}


