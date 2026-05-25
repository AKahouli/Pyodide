import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { ReplayExecutionPlan } from '../types';

function formatJsonPreview(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

interface Props {
  plan: ReplayExecutionPlan;
}

export function ReplayExecutionPlanCard({ plan }: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="rounded-lg border bg-muted/20 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">{t('replayPlanning.planTitle')}</div>
        <Badge variant="outline">v{plan.validationVersion}</Badge>
        {plan.intentLabel && <Badge variant="outline">{plan.intentLabel}</Badge>}
      </div>
      {plan.requiredStageLabels.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('replayPlanning.stages')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.requiredStageLabels.map((stage) => (
              <Badge key={stage} variant="outline">{stage}</Badge>
            ))}
          </div>
        </div>
      )}
      {plan.plannedToolSteps.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('replayPlanning.tools')}</div>
          {plan.plannedToolSteps.map((step) => (
            <div key={`${step.stepIndex}:${step.toolName}`} className="rounded-md border bg-background px-3 py-2">
              <div className="font-medium">{step.stepIndex}. {step.toolName}</div>
              <div className="text-muted-foreground">{step.purpose || t('replayPlanning.validatedPurpose')}</div>
              {step.argumentShapeKeys.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('replayPlanning.argumentShape')}: {step.argumentShapeKeys.join(', ')}
                </div>
              )}
              {Object.keys(step.expectedArgs ?? {}).length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('replayPlanning.expectedArgs')}: {formatJsonPreview(step.expectedArgs)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {plan.requiredOutputChecks.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('replayPlanning.outputChecks')}</div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {plan.requiredOutputChecks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
