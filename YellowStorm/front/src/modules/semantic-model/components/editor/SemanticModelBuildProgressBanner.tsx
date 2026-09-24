import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Loader2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModuleTranslation } from "@/modules/localization";
import { useSemanticBuildJob } from "../../hooks/use-semantic-build-job";
import type { SemanticBuildJob, SemanticBuildStep, SemanticBuildStepStatus } from "../../types";

interface Props {
  modelId: string;
  onRetry?: () => void;
}

const STEP_ORDER: SemanticBuildStep[] = ["ontology", "mapping", "apply"];

/**
 * Persistent banner mounted at the top of the semantic-model editor viewer.
 * Shows the state of the current or most recent build. Survives page reloads
 * (auto-reattaches to any active build via `GET /builds/latest`).
 */
export function SemanticModelBuildProgressBanner({ modelId, onRetry }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const { data: job } = useSemanticBuildJob(modelId);
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissed flag whenever a new build starts, so completed/failed
  // banners from previous runs don't stay hidden if the user launches again.
  useEffect(() => {
    if (job?.status === "running") setDismissed(false);
  }, [job?.buildId, job?.status]);

  const visible = useMemo(() => Boolean(job) && !dismissed && job!.status !== undefined, [job, dismissed]);
  if (!visible || !job) return null;

  const tone =
    job.status === "running" ? "border-primary/40 bg-primary/5" :
    job.status === "completed" ? "border-emerald-500/40 bg-emerald-500/5" :
    "border-destructive/40 bg-destructive/5";
  const title =
    job.status === "running" ? t("build.runningTitle") :
    job.status === "completed" ? t("build.completedTitle") :
    t("build.failedTitle");
  const description =
    job.status === "running" ? t("build.runningDescription") :
    job.status === "completed" ? t("build.completedDescription") :
    job.error ?? t("build.failedGeneric");

  return (
    <div className={`flex flex-col gap-2 border-b px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-start gap-3">
        <BannerIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-tight">{title}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-1">
          {job.status === "failed" && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t("build.retry")}
            </Button>
          )}
          {job.status !== "running" && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("build.dismiss")}
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-7">
        {STEP_ORDER.map((step) => (
          <StepChip
            key={step}
            label={t(`build.step${capitalize(step)}`)}
            status={stepStatusOf(job, step)}
            statusLabel={t(`build.stepStatus.${stepStatusOf(job, step)}`)}
          />
        ))}
      </div>
    </div>
  );
}

function BannerIcon({ status }: { status: SemanticBuildJob["status"] }) {
  if (status === "running") return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />;
  if (status === "completed") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
}

function StepChip({
  label,
  status,
  statusLabel,
}: {
  label: string;
  status: SemanticBuildStepStatus;
  statusLabel: string;
}) {
  const icon =
    status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> :
    status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> :
    status === "failed" ? <XCircle className="h-3.5 w-3.5 text-destructive" /> :
    <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  const textTone =
    status === "completed" ? "text-emerald-700 dark:text-emerald-400" :
    status === "running" ? "text-foreground" :
    status === "failed" ? "text-destructive" :
    "text-muted-foreground";
  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      {icon}
      <span className={`font-medium ${textTone}`}>{label}</span>
      <span className="text-muted-foreground">· {statusLabel}</span>
    </div>
  );
}

function stepStatusOf(job: SemanticBuildJob, step: SemanticBuildStep): SemanticBuildStepStatus {
  if (step === "ontology") return job.ontologyStatus;
  if (step === "mapping") return job.mappingStatus;
  return job.applyStatus;
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}
