import { useEffect, useState } from "react";
import { Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseApiError } from "@/lib/api-error";
import { showError, showSuccess } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { usePopulationRun } from "../../hooks/use-population-run";
import { useStartSemanticBuild } from "../../hooks/use-semantic-build-job";
import { useSemanticModelEditorStore } from "../../store";
import type { SemanticModelManualInstances } from "../../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  runtimeOwned?: boolean;
  onStarted?: () => void;
  /** Called when a population run was accepted by the runtime, with the sources it skipped. */
  onPopulationStarted?: (result: { jobId: string; status: string; skipped: Array<{ mappingId: string; reason: string }>; reused: boolean }) => void;
}

/**
 * Fire-and-forget launcher for the async build orchestrator.
 *
 * The dialog only collects the (optional) business requirements and posts
 * `POST /builds`. As soon as the backend returns a buildId, the dialog closes
 * and control is handed back to the user. Progress is tracked by the
 * `SemanticModelBuildProgressBanner` mounted at the top of the editor.
 */
export function SemanticModelValidateDialog({ open, onOpenChange, modelId, runtimeOwned, onStarted, onPopulationStarted }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const [requirements, setRequirements] = useState("");
  const [manualConceptId, setManualConceptId] = useState("");
  const [manualLabels, setManualLabels] = useState("");
  const [manualInstances, setManualInstances] = useState<SemanticModelManualInstances[]>([]);
  const graph = useSemanticModelEditorStore((state) => state.graph);
  const startBuild = useStartSemanticBuild(modelId);
  const populate = usePopulationRun(modelId);

  // Reset the textarea whenever the dialog opens fresh.
  useEffect(() => {
    if (open) {
      setRequirements("");
      setManualConceptId("");
      setManualLabels("");
      setManualInstances([]);
    }
  }, [open]);

  // Reading the sources goes through the semantic-model runtime: it populates from the
  // logical index, so it does not depend on the retired native-search service.
  const handleRead = async () => {
    try {
      const result = await populate.mutateAsync({ kind: "model" });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused });
      onOpenChange(false);
    } catch (error) {
      showError(t("population.startError"), { description: parseApiError(error).message });
    }
  };

  const handleLaunch = async () => {
    const businessRequirements = requirements
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      await startBuild.mutateAsync({ businessRequirements, applyMode: "replace", manualInstances });
      showSuccess(t("build.started"));
      onStarted?.();
      onOpenChange(false);
    } catch (error) {
      const apiError = parseApiError(error);
      const description = apiError.message;
      const message = description.toLowerCase().includes("already running")
        ? t("build.alreadyRunning")
        : t("build.startError");
      showError(message, { description });
    }
  };

  const addManualInstances = () => {
    const labels = manualLabels.split(",").map((label) => label.trim()).filter(Boolean);
    if (!manualConceptId || !labels.length) return;
    setManualInstances((current) => {
      const existing = current.find((item) => item.nodeTypeId === manualConceptId);
      if (!existing) return [...current, { nodeTypeId: manualConceptId, labels: [...new Set(labels)] }];
      return current.map((item) => item.nodeTypeId === manualConceptId
        ? { ...item, labels: [...new Set([...item.labels, ...labels])] }
        : item);
    });
    setManualLabels("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!startBuild.isPending && !populate.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t("validate.title")}
          </DialogTitle>
          <DialogDescription>{t(runtimeOwned ? "population.hint" : "validate.description")}</DialogDescription>
        </DialogHeader>

        {!runtimeOwned && <><div className="space-y-2 py-2">
          <label className="text-sm font-medium">{t("validate.requirements")}</label>
          <Textarea
            placeholder={t("validate.requirementsPlaceholder")}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            rows={4}
            className="resize-none text-sm"
            disabled={startBuild.isPending}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="text-sm font-medium">{t("records.type")}</label>
          <Select value={manualConceptId} onValueChange={setManualConceptId} disabled={startBuild.isPending}>
            <SelectTrigger><SelectValue placeholder={t("records.chooseType")} /></SelectTrigger>
            <SelectContent>
              {graph?.nodes.filter((node) => node.recordPolicy !== "none").map((node) => (
                <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input
              value={manualLabels}
              onChange={(event) => setManualLabels(event.target.value)}
              placeholder={t("records.placeholder")}
              disabled={startBuild.isPending}
            />
            <Button type="button" variant="outline" onClick={addManualInstances} disabled={!manualConceptId || !manualLabels.trim() || startBuild.isPending}>
              {t("records.add")}
            </Button>
          </div>
          {manualInstances.map((item) => {
            const label = graph?.nodes.find((node) => node.id === item.nodeTypeId)?.label ?? item.nodeTypeId;
            return <p key={item.nodeTypeId} className="text-xs text-muted-foreground">{label}: {item.labels.join(", ")}</p>;
          })}
        </div></>}

        <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
          <Button onClick={() => void handleRead()} disabled={startBuild.isPending || populate.isPending}>
            {populate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Sparkles className="mr-2 h-4 w-4" />
            {t("population.action")}
          </Button>
          {!runtimeOwned && <p className="text-center text-xs text-muted-foreground">{t("population.hint")}</p>}
          <div className="flex justify-end gap-2 border-t pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={startBuild.isPending || populate.isPending}>
              {t("action.cancel")}
            </Button>
            {!runtimeOwned && <Button variant="secondary" onClick={() => void handleLaunch()} disabled={startBuild.isPending || populate.isPending}>
              {startBuild.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("validate.launch")}
            </Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
