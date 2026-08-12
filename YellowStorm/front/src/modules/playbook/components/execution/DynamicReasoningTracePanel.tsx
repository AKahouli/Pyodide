import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { DynamicReasoningAttempt } from '../../types';

export function DynamicReasoningTracePanel({ attempt }: { attempt?: DynamicReasoningAttempt }) {
  const { t } = useModuleTranslation('playbook');
  if (!attempt) return null;
  const mode = String(attempt.decision?.mode ?? (attempt.acceptedPlan ? 'subgraph' : attempt.status));
  const summary = String(attempt.decision?.reasonSummary ?? attempt.fallbackReason ?? '');
  const planNodes = attempt.acceptedPlan
    ? [...attempt.acceptedPlan.nodes, attempt.acceptedPlan.synthesis]
    : [];
  const titlesById = new Map(planNodes.map((node) => [node.id, node.title]));
  return (
    <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('dynamicReasoning.trace.title')}</span>
        <Badge variant="outline">{mode === 'direct' ? t('dynamicReasoning.trace.direct') : t('dynamicReasoning.trace.subgraph')}</Badge>
        <Badge variant="secondary">{attempt.status}</Badge>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {attempt.acceptedPlan && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('dynamicReasoning.trace.acceptedPlan', { count: attempt.acceptedPlan.nodes.length })}
          </div>
          {planNodes.map((node) => (
            <div key={node.id} className="rounded border bg-background px-3 py-2 text-sm">
              <div className="font-medium">{node.title}</div>
              <div className="text-xs text-muted-foreground">
                {node.dependsOn.map((dependency) => titlesById.get(dependency) ?? t('dynamicReasoning.trace.unknownDependency')).join(' -> ') || t('dynamicReasoning.trace.rootTask')}
              </div>
            </div>
          ))}
        </div>
      )}
      {attempt.error && <p className="text-sm text-destructive">{String(attempt.error.message ?? t('dynamicReasoning.trace.failed'))}</p>}
    </div>
  );
}
