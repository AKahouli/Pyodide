import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';

describe('PlaybookFlowExecutionAdvisorMapper', () => {
  const mapper = new PlaybookFlowExecutionAdvisorMapper();

  it('maps grpc judge results into the frontend-aligned shape', () => {
    const result = mapper.mapGrpcJudgeResult({
      accuracy_score: 81,
      completeness_score: 79,
      result_matching_score: 74,
      overall_score: 78,
      confidence: 0.66,
      tool_usage_score: 71,
      expected_result_source: 'node_field',
      expected_result_type: 'semantic_description',
      expected_result_matched: true,
      expected_result_reason: 'Matched.',
      missing_facts: ['missing'],
      incoherences: ['issue'],
      unsupported_claims: ['claim'],
      handoff_risks: ['risk'],
      rewrite_hints: ['hint'],
      tool_selection_issues: ['selection'],
      missing_tool_calls: ['missing tool'],
      redundant_tool_calls: ['redundant'],
      tool_output_use_issues: ['output use'],
      tool_sequencing_issues: ['sequence'],
      tool_usage_strengths: ['strength'],
      tool_usage_recommendation: 'Use tools better.',
      safe_auto_fix_type: 'optimize_step',
      recommendation: 'update_current_playbook',
      reason: 'done',
    });

    expect(result).toMatchObject({
      accuracyScore: 81,
      completenessScore: 79,
      resultMatchingScore: 74,
      overallScore: 78,
      confidence: 0.66,
      toolUsageScore: 71,
      expectedResultSource: 'node_field',
      expectedResultType: 'semantic_description',
      expectedResultMatched: true,
      expectedResultReason: 'Matched.',
      toolUsageRecommendation: 'Use tools better.',
      safeAutoFixType: 'optimize_step',
      recommendation: 'update_current_playbook',
      reason: 'done',
    });
  });
});
