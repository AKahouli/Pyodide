import { FlowTaskResultSchema } from './playbook-flow-task-result.schema';

describe('FlowTaskResultSchema', () => {
  it('persists every advisor judge result field rendered by the frontend', () => {
    const judgeResultPath = FlowTaskResultSchema.path('judgeResult') as { schema: { path: (key: string) => unknown } };
    const judgeHistoryPath = FlowTaskResultSchema.path('judgeHistory') as { schema: { path: (key: string) => unknown } };
    const historyJudgeResultPath = judgeHistoryPath.schema.path('judgeResult') as { schema: { path: (key: string) => unknown } };
    const fields = [
      'accuracyScore',
      'completenessScore',
      'resultMatchingScore',
      'overallScore',
      'confidence',
      'toolUsageScore',
      'relevanceScore',
      'specificityScore',
      'formatComplianceScore',
      'evidenceGroundingScore',
      'handoffReadinessScore',
      'hitlAppropriatenessScore',
      'determinismScore',
      'costEfficiencyScore',
      'stepOptimizationPriority',
      'playbookOptimizationPriority',
      'costOptimizationPriority',
      'riskSeverity',
      'blockingIssueCount',
      'downstreamImpactLevel',
      'recommendedAction',
      'availableActions',
    ];

    for (const field of fields) {
      expect(judgeResultPath.schema.path(field)).toBeDefined();
      expect(historyJudgeResultPath.schema.path(field)).toBeDefined();
    }
  });
});
