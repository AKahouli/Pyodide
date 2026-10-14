import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw, Share2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { parseApiError } from "@/lib/api-error";
import { showError, showSuccess } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { usePopulationRun, useRebuildFromScratch, useReprojectGraph } from "../../hooks/use-population-run";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  /** Called when a population run was accepted by the runtime, with the sources it skipped. */
  onPopulationStarted?: (result: { jobId: string; status: string; skipped: Array<{ mappingId: string; reason: string }>; reused: boolean; sourceCount?: number; cleared?: boolean }) => void;
  /** A run that could not start: what stops it is listed in Review, with where to fix it. */
  onRefused?: (message: string) => void;
}

type RunMode = "update" | "graph" | "scratch";
const MODES: RunMode[] = ["update", "graph", "scratch"];
const MODE_ICON = { update: Sparkles, graph: Share2, scratch: RotateCcw } as const;

/**
 * One screen to start a run: pick what to do (read the sources, rebuild only the graph, or start
 * over from nothing), with the options of that choice, then one button. Starting over deletes
 * the generated data, so its warning stays in view and its button is red.
 */
export function SemanticModelValidateDialog({ open, onOpenChange, modelId, onPopulationStarted, onRefused }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const populate = usePopulationRun(modelId);
  const rebuild = useRebuildFromScratch(modelId);
  const reproject = useReprojectGraph(modelId);
  const [mode, setMode] = useState<RunMode>("update");
  const [forgetDocumentReading, setForgetDocumentReading] = useState(false);
  const busy = populate.isPending || rebuild.isPending || reproject.isPending;
  useEffect(() => { if (!open) { setMode("update"); setForgetDocumentReading(false); } }, [open]);
  // The AI option is a choice per run: changing what to do starts it unticked again.
  useEffect(() => { setForgetDocumentReading(false); }, [mode]);

  const read = async () => {
    try {
      const result = await populate.mutateAsync({ rereadDocuments: forgetDocumentReading });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused, sourceCount: result.sourceCount });
      onOpenChange(false);
    } catch (error) {
      const message = parseApiError(error).message;
      showError(t("population.startError"), { description: message, duration: 10000 });
      onRefused?.(message);
    }
  };

  const graphOnly = async () => {
    try {
      const result = await reproject.mutateAsync();
      if (!result.revisions.length) {
        showError(t("population.graphError"), { description: t("population.graphNothing") });
        return;
      }
      const largest = result.revisions.reduce((best, item) => (item.vertices ?? 0) >= (best.vertices ?? 0) ? item : best);
      showSuccess(t("population.graphRebuilt"), { description: t("population.graphRebuiltHint", { records: largest.vertices ?? 0, links: largest.edges ?? 0 }) });
      onOpenChange(false);
    } catch (error) {
      showError(t("population.graphError"), { description: parseApiError(error).message, duration: 10000 });
    }
  };

  const startOver = async () => {
    try {
      const result = await rebuild.mutateAsync({ forgetDocumentReading });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused, sourceCount: result.sourceCount, cleared: true });
      onOpenChange(false);
    } catch (error) {
      const apiError = parseApiError(error);
      const running = apiError.message.includes("population_running");
      showError(t("rebuild.error"), { description: running ? t("rebuild.running") : apiError.message, duration: 10000 });
      if (!running) onRefused?.(apiError.message);
    }
  };

  const start = () => void (mode === "graph" ? graphOnly() : mode === "scratch" ? startOver() : read());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t("validate.title")}
          </DialogTitle>
          <DialogDescription>{t("run.description")}</DialogDescription>
        </DialogHeader>

        <RadioGroup value={mode} onValueChange={(value) => setMode(value as RunMode)} disabled={busy} className="gap-2" aria-label={t("run.choose")}>
          {MODES.map((value) => {
            const Icon = MODE_ICON[value];
            const selected = mode === value;
            const danger = value === "scratch";
            return (
              <div key={value} className={`rounded-lg border p-3 text-sm transition-colors ${selected ? (danger ? "border-destructive/60 bg-destructive/5" : "border-primary/60 bg-primary/5") : "hover:bg-muted/50"}`}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <RadioGroupItem value={value} className="mt-0.5" aria-describedby={`run-${value}-hint`} />
                  <span className="min-w-0">
                    <span className={`flex items-center gap-1.5 font-medium ${danger && selected ? "text-destructive" : ""}`}>
                      <Icon className="h-3.5 w-3.5" />{t(`run.mode.${value}.title`)}
                    </span>
                    <span id={`run-${value}-hint`} className="mt-0.5 block text-xs text-muted-foreground">{t(`run.mode.${value}.hint`)}</span>
                  </span>
                </label>
                {selected && value !== "graph" && <div className="mt-3 space-y-2 ps-6">
                  {value === "scratch" && <div role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                    <p className="text-destructive">{t("rebuild.removed")}</p>
                    <p className="text-muted-foreground">{t("rebuild.kept")}</p>
                  </div>}
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox className="mt-0.5" checked={forgetDocumentReading} onCheckedChange={(checked) => setForgetDocumentReading(checked === true)} disabled={busy} />
                    <span>
                      <span className="text-xs font-medium">{t("rebuild.forget")}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t("rebuild.forgetHint")}</span>
                    </span>
                  </label>
                </div>}
              </div>
            );
          })}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("action.cancel")}</Button>
          <Button variant={mode === "scratch" ? "destructive" : "default"} onClick={start} disabled={busy}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Play className="me-2 h-4 w-4" />}
            {t(`run.mode.${mode}.action`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
