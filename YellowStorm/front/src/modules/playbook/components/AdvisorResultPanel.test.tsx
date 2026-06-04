import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdvisorResultPanel } from './AdvisorResultPanel';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'detail.judge.blockingIssueCount') return `${values?.count ?? 0} blocking issues`;
      return key;
    },
  }),
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: any) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: any) => <button type="button">{children}</button>,
  CollapsibleContent: ({ children }: any) => <div>{children}</div>,
}));

describe('AdvisorResultPanel', () => {
  it('groups advisor metrics by quality, robustness, and priority', () => {
    render(
      <AdvisorResultPanel
        judgeResult={{
          overallScore: 72,
          toolUsageScore: 80,
          resultMatchingScore: 70,
          confidence: 0.82,
          expectedResultSource: 'node_field',
          expectedResultType: 'semantic_description',
          expectedResultMatched: true,
          expectedResultReason: 'Matched.',
          reason: 'Improve the output contract.',
          recommendedAction: 'improve_output_contract',
          riskSeverity: 'medium',
          downstreamImpactLevel: 'high',
          blockingIssueCount: 2,
          accuracyScore: 75,
          completenessScore: 68,
          relevanceScore: 82,
          specificityScore: 64,
          formatComplianceScore: 55,
          evidenceGroundingScore: 61,
          handoffReadinessScore: 59,
          hitlAppropriatenessScore: 77,
          determinismScore: 63,
          stepOptimizationPriority: 88,
          playbookOptimizationPriority: 42,
          missingFacts: [],
          incoherences: [],
          unsupportedClaims: [],
          handoffRisks: [],
          toolSelectionIssues: [],
          missingToolCalls: [],
          redundantToolCalls: [],
          toolOutputUseIssues: [],
          toolSequencingIssues: [],
          toolUsageStrengths: [],
          rewriteHints: [],
        } as any}
      />,
    );

    expect(screen.getByText('detail.judge.qualityMetrics')).toBeInTheDocument();
    expect(screen.getByText('detail.judge.robustnessMetrics')).toBeInTheDocument();
    expect(screen.getByText('detail.judge.priorityMetrics')).toBeInTheDocument();
    expect(screen.getByText('detail.judge.relevanceScore')).toBeInTheDocument();
    expect(screen.getByText('detail.judge.determinismScore')).toBeInTheDocument();
    expect(screen.getByText('detail.judge.stepOptimizationPriority')).toBeInTheDocument();
  });
});
