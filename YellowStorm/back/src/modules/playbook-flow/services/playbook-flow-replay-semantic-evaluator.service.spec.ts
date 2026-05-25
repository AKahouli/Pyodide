import { PlaybookFlowReplaySemanticEvaluatorService } from './playbook-flow-replay-semantic-evaluator.service';

describe('PlaybookFlowReplaySemanticEvaluatorService', () => {
  const service = new PlaybookFlowReplaySemanticEvaluatorService();

  it('detects missing required semantic points from the instantiated checklist', () => {
    const result = service.evaluate({
      output: 'This answer mentions NVDA but omits any final section heading.',
      planning: {
        replayId: 'replay-1',
        validationVersion: 1,
        intentKey: 'earnings.summary',
        intentLabel: 'Summarize earnings',
        contextMapping: [
          {
            variableKey: 'ticker', key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true,
            baselineValue: 'AAPL', currentValue: 'NVDA', confidence: 1, reason: 'matched_input_context', value: 'NVDA', matched: true,
          },
        ],
        executionPlan: {
          taskId: 'task-1', replayId: 'replay-1', validationVersion: 1, intentKey: 'earnings.summary', intentLabel: 'Summarize earnings',
          matchedContextCount: 1, missingRequiredContextCount: 0, requiredStageLabels: [], requiredOutputChecks: [], plannedToolSteps: [],
          semanticChecklist: [
            { key: 'section:summary', description: 'Include section: Summary.', variables: [], severity: 'fail', source: 'output_contract' },
          ],
        },
      },
    });

    expect(result?.missingPointFindings).toEqual([
      expect.objectContaining({ key: 'section:summary', severity: 'fail' }),
    ]);
  });

  it('detects stale baseline context references in the output', () => {
    const result = service.evaluate({
      output: 'AAPL remains the focus of this answer.',
      planning: {
        replayId: 'replay-1',
        validationVersion: 1,
        intentKey: null,
        intentLabel: null,
        contextMapping: [
          {
            variableKey: 'ticker', key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true,
            baselineValue: 'AAPL', currentValue: 'NVDA', confidence: 1, reason: 'matched_input_context', value: 'NVDA', matched: true,
          },
        ],
        executionPlan: {
          taskId: 'task-1', replayId: 'replay-1', validationVersion: 1, intentKey: null, intentLabel: null,
          matchedContextCount: 1, missingRequiredContextCount: 0, requiredStageLabels: [], requiredOutputChecks: [], plannedToolSteps: [],
          semanticChecklist: [
            { key: 'context:ticker', description: 'Use Ticker: NVDA.', variables: ['ticker'], severity: 'fail', source: 'context' },
          ],
        },
      },
    });

    expect(result?.staleContextReferenceFindings).toEqual([
      expect.objectContaining({ key: 'ticker', observed: 'AAPL', expected: 'NVDA' }),
    ]);
  });
});
