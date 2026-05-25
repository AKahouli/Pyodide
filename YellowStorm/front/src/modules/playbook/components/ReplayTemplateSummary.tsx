import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { ValidatedTaskReplay } from '../types';

interface ReplayTemplateSummaryProps {
  replay: ValidatedTaskReplay;
}

function formatStructuredValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function ReplayTemplateSummary({ replay }: ReplayTemplateSummaryProps) {
  const { t } = useModuleTranslation('playbook');
  const reasoningOutline = replay.reasoningOutline ?? [];
  const stableReasoningRules = replay.stableReasoningRules ?? [];
  const contextVariableSchema = replay.contextVariableSchema ?? [];
  const toolTraceTemplate = replay.toolTraceTemplate ?? [];
  const acceptedExamples = replay.acceptedExamples ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.template.intentKey')}</div>
          <div className="mt-1 break-words font-medium">{replay.intentKey || '-'}</div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('baselineBadge.template.intentLabel')}</div>
          <div className="mt-1 break-words font-medium">{replay.intentLabel || replay.taskTitle || '-'}</div>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.reasoningOutline')}</div>
        {reasoningOutline.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.reasoningOutline')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {reasoningOutline.map((item) => (
              <div key={item.stageKey} className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.label}</span>
                  <Badge variant="outline">{item.stageType}</Badge>
                  {item.confidence != null && <Badge variant="secondary">{t('baselineBadge.reasoningConfidence', { value: item.confidence })}</Badge>}
                </div>
                <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{item.description || '-'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.stableReasoningRules')}</div>
        {stableReasoningRules.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.stableReasoningRules')}</div>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {stableReasoningRules.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.contextVariables')}</div>
        {contextVariableSchema.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.contextVariables')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {contextVariableSchema.map((item) => (
              <div key={item.key} className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.label}</span>
                  <Badge variant="outline">{item.source}</Badge>
                  <Badge variant="secondary">{item.valueType}</Badge>
                </div>
                <div className="mt-2 text-muted-foreground">{item.key}</div>
                <div className="mt-1 text-muted-foreground">{item.exampleValue || '-'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.toolTemplate')}</div>
        {toolTraceTemplate.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.toolTemplate')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {toolTraceTemplate.map((item) => (
              <div key={`${item.stepIndex}-${item.toolName}`} className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{item.stepIndex}.</span>
                  <code className="rounded bg-background px-1.5 py-0.5 text-xs">{item.toolName}</code>
                  {item.required && <Badge variant="secondary">{t('baselineBadge.template.required')}</Badge>}
                </div>
                <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{item.purpose || '-'}</div>
                <pre className="mt-3 max-h-64 overflow-auto rounded bg-background p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(item.argumentShape)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.outputContract')}</div>
        {replay.outputContract ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(replay.outputContract)}</pre>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.outputContract')}</div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.driftPolicy')}</div>
        {replay.driftPolicy ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">{formatStructuredValue(replay.driftPolicy)}</pre>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.driftPolicy')}</div>
        )}
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="font-medium">{t('baselineBadge.sections.acceptedExamples')}</div>
        {acceptedExamples.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">{t('baselineBadge.empty.acceptedExamples')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {acceptedExamples.map((item) => (
              <div key={`${item.referenceExecutionId}-${item.referenceExecutionNumber}`} className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">#{item.referenceExecutionNumber}</div>
                <div className="mt-1 text-muted-foreground">{item.summary}</div>
                <div className="mt-1 text-muted-foreground whitespace-pre-wrap">{item.outputPreview || '-'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
