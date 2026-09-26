import { Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseApiError } from "@/lib/api-error";
import { showError } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import { usePopulationRun } from "../../hooks/use-population-run";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  /** Called when a population run was accepted by the runtime, with the sources it skipped. */
  onPopulationStarted?: (result: { jobId: string; status: string; skipped: Array<{ mappingId: string; reason: string }>; reused: boolean }) => void;
}

/**
 * Starts a whole-model population run on the semantic-model runtime. Records typed by
 * hand on the draft are sent along as a manual source.
 */
export function SemanticModelValidateDialog({ open, onOpenChange, modelId, onPopulationStarted }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const populate = usePopulationRun(modelId);

  const handleRead = async () => {
    try {
      const result = await populate.mutateAsync({ kind: "model" });
      onPopulationStarted?.({ jobId: result.jobId, status: result.status, skipped: result.skipped, reused: result.reused });
      onOpenChange(false);
    } catch (error) {
      showError(t("population.startError"), { description: parseApiError(error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!populate.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t("validate.title")}
          </DialogTitle>
          <DialogDescription>{t("population.hint")}</DialogDescription>
        </DialogHeader>

        <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
          <Button onClick={() => void handleRead()} disabled={populate.isPending}>
            {populate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Sparkles className="mr-2 h-4 w-4" />
            {t("population.action")}
          </Button>
          <div className="flex justify-end gap-2 border-t pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={populate.isPending}>
              {t("action.cancel")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
