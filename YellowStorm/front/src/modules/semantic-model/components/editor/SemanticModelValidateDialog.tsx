import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseApiError } from "@/lib/api-error";
import { showError } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { usePopulationRun, useRebuildFromScratch } from "../../hooks/use-population-run";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  /** Called when a population run was accepted by the runtime, with the sources it skipped. */
  onPopulationStarted?: (result: { jobId: string; status: string; skipped: Array<{ mappingId: string; reason: string }>; reused: boolean; sourceCount?: number; cleared?: boolean }) => void;
}

/**
 * Starts a whole-model population run on the semantic-model runtime. Records typed by
 * hand on the draft are sent along as a manual source. A second, confirmed action clears
 * all generated data first and repopulates the model from scratch.
 */
export function SemanticModelValidateDialog({ open, onOpenChange, modelId, onPopulationStarted }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const populate = usePopulationRun(modelId);
  const rebuild = useRebuildFromScratch(modelId);
  const [confirming, setConfirming] = useState(false);
  const [forgetDocumentReading, setForgetDocumentReading] = useState(false);
  const busy = populate.isPending || rebuild.isPending;
  useEffect(() => { if (!open) { setConfirming(false); setForgetDocumentReading(false); } }, [open]);

  const handleRead = async () => {
    try {
      const result = await populate.mutateAsync({ kind: "model" });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused, sourceCount: result.sourceCount });
      onOpenChange(false);
    } catch (error) {
      showError(t("population.startError"), { description: parseApiError(error).message });
    }
  };

  const handleRebuild = async () => {
    try {
      const result = await rebuild.mutateAsync({ forgetDocumentReading });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused, sourceCount: result.sourceCount, cleared: true });
      onOpenChange(false);
    } catch (error) {
      const apiError = parseApiError(error);
      showError(t("rebuild.error"), { description: apiError.message.includes("population_running") ? t("rebuild.running") : apiError.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        {confirming ? <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("rebuild.title")}
            </DialogTitle>
            <DialogDescription>{t("rebuild.description")}</DialogDescription>
          </DialogHeader>
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">{t("rebuild.removed")}</p>
            <p className="text-muted-foreground">{t("rebuild.kept")}</p>
          </div>
          <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <Checkbox className="mt-0.5" checked={forgetDocumentReading} onCheckedChange={(checked) => setForgetDocumentReading(checked === true)} disabled={busy} />
            <span>
              <span className="font-medium">{t("rebuild.forget")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t("rebuild.forgetHint")}</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>{t("action.cancel")}</Button>
            <Button variant="destructive" onClick={() => void handleRebuild()} disabled={busy}>
              {rebuild.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              {t("rebuild.confirm")}
            </Button>
          </DialogFooter>
        </> : <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              {t("validate.title")}
            </DialogTitle>
            <DialogDescription>{t("population.hint")}</DialogDescription>
          </DialogHeader>

          <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
            <Button onClick={() => void handleRead()} disabled={busy}>
              {populate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-2 h-4 w-4" />
              {t("population.action")}
            </Button>
            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirming(true)} disabled={busy} title={t("rebuild.buttonHint")}>
                <RotateCcw className="mr-1.5 h-4 w-4" />{t("rebuild.button")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t("action.cancel")}
              </Button>
            </div>
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}
