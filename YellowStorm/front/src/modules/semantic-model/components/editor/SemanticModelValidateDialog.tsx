import { useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { parseApiError } from "@/lib/api-error";
import { useModuleTranslation } from "@/modules/localization";
import { semanticModelApi } from "../../api";
import type { MappingProposalJob } from "../../types";

type StepStatus = "pending" | "running" | "done" | "error";

interface Step {
  id: string;
  labelKey: string;
  status: StepStatus;
}

const initialSteps = (): Step[] => [
  { id: "ontology", labelKey: "validate.stepOntology", status: "pending" },
  { id: "mapping",  labelKey: "validate.stepMapping",  status: "pending" },
  { id: "apply",    labelKey: "validate.stepApply",    status: "pending" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  onSuccess: () => void;
}

export function SemanticModelValidateDialog({ open, onOpenChange, modelId, onSuccess }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const [requirements, setRequirements] = useState("");
  const [steps, setSteps] = useState<Step[]>(initialSteps());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphWarning, setGraphWarning] = useState<string | null>(null);
  const abortRef = useRef(false);

  const updateStep = (id: string, status: StepStatus) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));

  const pollMapping = (jobId: string): Promise<MappingProposalJob> =>
    new Promise((resolve, reject) => {
      const tick = async () => {
        if (abortRef.current) return reject(new Error("cancelled"));
        try {
          const job = await semanticModelApi.getMappingProposalJob(modelId, jobId);
          if (job.status === "completed") return resolve(job);
          if (job.status === "failed") return reject(new Error(job.error ?? "Mapping failed"));
          setTimeout(tick, 5000);
        } catch (e) {
          reject(e);
        }
      };
      setTimeout(tick, 5000);
    });

  const handleLaunch = async () => {
    abortRef.current = false;
    setRunning(true);
    setDone(false);
    setError(null);
    setSteps(initialSteps());

    try {
      // Step 1 — generate ontology (requirements optional)
      updateStep("ontology", "running");
      const reqs = requirements.split("\n").map((r) => r.trim()).filter(Boolean);
      await semanticModelApi.generateOntology(modelId, reqs);
      updateStep("ontology", "done");

      if (abortRef.current) return;

      // Step 2 — run mapping + poll until complete
      updateStep("mapping", "running");
      const { jobId } = await semanticModelApi.startMappingProposalJob(modelId);
      const completedJob = await pollMapping(jobId);
      updateStep("mapping", "done");

      if (abortRef.current) return;

      // Step 3 — apply mapping plan to SQL + build AGE graph
      updateStep("apply", "running");
      const applyResult = await semanticModelApi.applyMappingPlan(modelId, completedJob.jobId, 'replace');
      updateStep("apply", "done");

      if (applyResult.graphViewerWarning) {
        setGraphWarning(applyResult.graphViewerWarning);
      }

      setDone(true);
      if (!applyResult.graphViewerWarning) {
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
          reset();
        }, 800);
      } else {
        onSuccess();
      }
    } catch (err) {
      setError(parseApiError(err).message);
      setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)));
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setSteps(initialSteps());
    setDone(false);
    setError(null);
    setGraphWarning(null);
    setRunning(false);
  };

  const handleClose = () => {
    if (running) abortRef.current = true;
    onOpenChange(false);
    setTimeout(reset, 300);
  };

  const hasStarted = steps.some((s) => s.status !== "pending");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t("validate.title")}
          </DialogTitle>
          <DialogDescription>{t("validate.description")}</DialogDescription>
        </DialogHeader>

        {!hasStarted && (
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">{t("validate.requirements")}</label>
            <Textarea
              placeholder={t("validate.requirementsPlaceholder")}
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={4}
              className="resize-none text-sm"
            />
          </div>
        )}

        {hasStarted && (
          <div className="space-y-3 py-2">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-3 text-sm">
                {step.status === "pending" && <Circle className="h-4 w-4 text-muted-foreground" />}
                {step.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {step.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {step.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                <span className={
                  step.status === "pending" ? "text-muted-foreground" :
                  step.status === "error" ? "text-destructive" : ""
                }>
                  {t(step.labelKey)}
                </span>
              </div>
            ))}
            {done && !graphWarning && (
              <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                {t("validate.done")}
              </p>
            )}
            {graphWarning && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{graphWarning}</p>
            )}
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={running}>
            {t("action.cancel")}
          </Button>
          {!done && (
            <Button onClick={() => void handleLaunch()} disabled={running}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("validate.launch")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
