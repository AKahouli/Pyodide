import { ChevronDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { TaskResult } from '../types';

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const scaled = value <= 1 ? value * 100 : value;
  return `${Math.round(scaled)}%`;
}

function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function getScoreTone(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'border-border/60 bg-muted/20';
  if (value >= 80) return 'border-emerald-500/30 bg-emerald-500/10';
  if (value >= 60) return 'border-amber-500/30 bg-amber-500/10';
  return 'border-rose-500/30 bg-rose-500/10';
}

function normalizeExpectedResultSource(value: string | null | undefined): 'node_field' | 'golden_baseline' | 'none' {
  return value === 'node_field' || value === 'golden_baseline' || value === 'none' ? value : 'none';
}

function normalizeExpectedResultType(value: string | null | undefined): 'exact_value' | 'semantic_description' | 'numeric_presentation' | 'document_generation' | 'baseline_comparison' | 'none' {
  return value === 'exact_value'
    || value === 'semantic_description'
    || value === 'numeric_presentation'
    || value === 'document_generation'
    || value === 'baseline_comparison'
    || value === 'none'
    ? value
    : 'none';
}

function normalizeAdvisorScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function getExpectedMatchTone(source: string | null | undefined, score: number | null | undefined): string {
  if (source === 'none') return 'border-slate-400/40 bg-slate-500/10';
  return getScoreTone(score);
}

function IssueSection({
  title,
  badge,
  badgeClassName,
  items,
  emptyLabel,
}: Readonly<{
  title: string;
  badge: string;
  badgeClassName: string;
  items: string[];
  emptyLabel: string;
}>) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className={cn('text-[10px] border', badgeClassName)}>
          {badge}
        </Badge>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className="whitespace-pre-wrap">{item}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">{emptyLabel}</div>
      )}
    </div>
  );
}

function MetricGroup({
  title,
  metrics,
}: Readonly<{
  title: string;
  metrics: Array<{ label: string; value: number | null | undefined }>;
}>) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className={cn('rounded border px-2 py-1.5', getScoreTone(metric.value))}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{metric.label}</div>
            <div className="mt-1 text-sm font-semibold">{formatPercent(metric.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdvisorResultPanel({
  judgeResult,
  className,
}: Readonly<{
  judgeResult: NonNullable<TaskResult['judgeResult']>;
  className?: string;
}>) {
  const { t } = useModuleTranslation('playbook');

  const normalizedExpectedResultSource = normalizeExpectedResultSource(judgeResult.expectedResultSource);
  const normalizedExpectedResultType = normalizeExpectedResultType(judgeResult.expectedResultType);
  const normalizedResultMatchingScore = normalizeAdvisorScore(judgeResult.resultMatchingScore);

  const issueSections = [
    {
      title: t('detail.judge.structuralIssues'),
      badge: t('detail.remediation.category.structure'),
      badgeClassName: 'bg-purple-100 text-purple-700 border-purple-200',
      items: judgeResult.missingFacts || [],
    },
    {
      title: t('detail.judge.promptIssues'),
      badge: t('detail.remediation.category.prompt'),
      badgeClassName: 'bg-blue-100 text-blue-700 border-blue-200',
      items: judgeResult.incoherences || [],
    },
    {
      title: t('detail.judge.evidenceIssues'),
      badge: t('detail.remediation.category.evidence'),
      badgeClassName: 'bg-sky-100 text-sky-700 border-sky-200',
      items: judgeResult.unsupportedClaims || [],
    },
    {
      title: t('detail.judge.handoffIssues'),
      badge: t('detail.remediation.category.handoff'),
      badgeClassName: 'bg-rose-100 text-rose-700 border-rose-200',
      items: judgeResult.handoffRisks || [],
    },
    {
      title: t('detail.judge.toolSelectionIssues'),
      badge: t('detail.remediation.category.tooling'),
      badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      items: judgeResult.toolSelectionIssues || [],
    },
    {
      title: t('detail.judge.missingToolCalls'),
      badge: t('detail.remediation.category.tooling'),
      badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      items: judgeResult.missingToolCalls || [],
    },
    {
      title: t('detail.judge.redundantToolCalls'),
      badge: t('detail.remediation.category.tooling'),
      badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      items: judgeResult.redundantToolCalls || [],
    },
    {
      title: t('detail.judge.toolOutputUseIssues'),
      badge: t('detail.remediation.category.evidence'),
      badgeClassName: 'bg-sky-100 text-sky-700 border-sky-200',
      items: judgeResult.toolOutputUseIssues || [],
    },
    {
      title: t('detail.judge.toolSequencingIssues'),
      badge: t('detail.remediation.category.tooling'),
      badgeClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      items: judgeResult.toolSequencingIssues || [],
    },
    {
      title: t('detail.judge.toolUsageStrengths'),
      badge: t('detail.remediation.category.evidence'),
      badgeClassName: 'bg-sky-100 text-sky-700 border-sky-200',
      items: judgeResult.toolUsageStrengths || [],
    },
  ];

  const issueCount = issueSections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className={cn('rounded-md border px-3 py-2', getScoreTone(judgeResult.overallScore))}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.overallScore')}</div>
            <div className="mt-1 text-lg font-semibold">{formatPercent(judgeResult.overallScore)}</div>
          </div>
          <div className={cn('rounded-md border px-3 py-2', getScoreTone(judgeResult.toolUsageScore))}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.toolUsageScore')}</div>
            <div className="mt-1 text-lg font-semibold">{formatPercent(judgeResult.toolUsageScore)}</div>
          </div>
          <div className={cn('rounded-md border px-3 py-2', getExpectedMatchTone(normalizedExpectedResultSource, normalizedResultMatchingScore))}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.expectedMatch')}</div>
            <div className="mt-1 text-lg font-semibold">
              {normalizedExpectedResultSource === 'none' ? t('detail.judge.notEvaluated') : formatPercent(normalizedResultMatchingScore)}
            </div>
          </div>
          <div className={cn('rounded-md border px-3 py-2', getScoreTone(judgeResult.confidence))}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.confidence')}</div>
            <div className="mt-1 text-lg font-semibold">{formatConfidence(judgeResult.confidence)}</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('detail.judge.recommendationTitle')}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{judgeResult.reason || t('detail.judge.noReason')}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{t(`detail.judge.recommendedAction.${judgeResult.recommendedAction || 'review_only'}` as any)}</Badge>
            <Badge variant="outline">{t(`detail.judge.riskSeverity.${judgeResult.riskSeverity || 'low'}` as any)}</Badge>
            <Badge variant="outline">{t(`detail.judge.downstreamImpact.${judgeResult.downstreamImpactLevel || 'none'}` as any)}</Badge>
            <Badge variant="outline">{t('detail.judge.blockingIssueCount', { count: judgeResult.blockingIssueCount ?? 0 })}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <MetricGroup
            title={t('detail.judge.qualityMetrics')}
            metrics={[
              { label: t('detail.judge.accuracyScore'), value: judgeResult.accuracyScore },
              { label: t('detail.judge.completenessScore'), value: judgeResult.completenessScore },
              { label: t('detail.judge.relevanceScore'), value: judgeResult.relevanceScore },
              { label: t('detail.judge.specificityScore'), value: judgeResult.specificityScore },
            ]}
          />
          <MetricGroup
            title={t('detail.judge.robustnessMetrics')}
            metrics={[
              { label: t('detail.judge.formatComplianceScore'), value: judgeResult.formatComplianceScore },
              { label: t('detail.judge.evidenceGroundingScore'), value: judgeResult.evidenceGroundingScore },
              { label: t('detail.judge.handoffReadinessScore'), value: judgeResult.handoffReadinessScore },
              { label: t('detail.judge.hitlAppropriatenessScore'), value: judgeResult.hitlAppropriatenessScore },
              { label: t('detail.judge.determinismScore'), value: judgeResult.determinismScore },
            ]}
          />
          <MetricGroup
            title={t('detail.judge.priorityMetrics')}
            metrics={[
              { label: t('detail.judge.stepOptimizationPriority'), value: judgeResult.stepOptimizationPriority },
              { label: t('detail.judge.playbookOptimizationPriority'), value: judgeResult.playbookOptimizationPriority },
            ]}
          />
        </div>

        <div className="mt-4 rounded-md border bg-muted/20 px-3 py-3 text-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.judge.expectedResultSourceLabel')}</div>
              <div className="mt-1 font-medium">{t(`detail.judge.expectedResultSource.${normalizedExpectedResultSource}` as any)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.judge.expectedResultTypeLabel')}</div>
              <div className="mt-1 font-medium">{t(`detail.judge.expectedResultType.${normalizedExpectedResultType}` as any)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.judge.expectedResultMatchedLabel')}</div>
              <div className="mt-1 font-medium">
                {normalizedExpectedResultSource === 'none'
                  ? t('detail.judge.notEvaluated')
                  : t(`detail.judge.expectedResultMatched.${judgeResult.expectedResultMatched ? 'yes' : 'no'}` as any)}
              </div>
            </div>
          </div>
          <div className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">{t('detail.judge.expectedResultExplanationTitle')}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {normalizedExpectedResultSource === 'none'
              ? t('detail.judge.expectedResultNoneExplanation')
              : (judgeResult.expectedResultReason || t('detail.judge.expectedResultReasonFallback'))}
          </p>
        </div>
      </div>

      <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>{t('detail.judge.issueSections')}</span>
            <span>{t('detail.judge.issueSummary', { count: issueCount })}</span>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          {issueSections.map((section) => (
            <IssueSection
              key={section.title}
              title={section.title}
              badge={section.badge}
              badgeClassName={section.badgeClassName}
              items={section.items}
              emptyLabel={t('detail.judge.none')}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible defaultOpen={false} className="rounded-lg border bg-background p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('detail.judge.toolUsageRecommendation')}</div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {judgeResult.toolUsageRecommendation || t('detail.judge.noReason')}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
