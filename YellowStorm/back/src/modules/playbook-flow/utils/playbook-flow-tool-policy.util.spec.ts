import { evaluateToolReplayEnforcement } from './playbook-flow-tool-policy.util';

describe('evaluateToolReplayEnforcement', () => {
  const contextMapping = [
    {
      variableKey: 'ticker',
      key: 'ticker',
      label: 'Ticker',
      source: 'input_context' as const,
      valueType: 'string' as const,
      required: true,
      baselineValue: 'AAPL',
      currentValue: 'NVDA',
      confidence: 1,
      reason: 'matched_input_context',
      value: 'NVDA',
      matched: true,
    },
  ];

  const expectedSteps = [
    {
      stepIndex: 1,
      toolName: 'search_financials',
      purpose: 'load earnings',
      required: true,
      argumentShape: { ticker: 'string' },
      argumentShapeKeys: ['ticker'],
      expectedArgs: { ticker: 'NVDA' },
      sourceCallIndex: 1,
    },
  ];

  it('fails strict mode when a required tool is missing', () => {
    const result = evaluateToolReplayEnforcement({
      mode: 'replay_strict',
      expectedSteps,
      observedToolTrace: [],
      contextMapping,
      allowAdditionalTools: false,
    });

    expect(result.blockedBy).toContain('missing_required_tool');
    expect(result.comparisons).toEqual([
      expect.objectContaining({ status: 'missing', reasons: ['missing_required_tool'] }),
    ]);
  });

  it('fails strict mode when an extra tool is used', () => {
    const result = evaluateToolReplayEnforcement({
      mode: 'replay_strict',
      expectedSteps,
      observedToolTrace: [
        { callIndex: 1, toolName: 'search_financials', args: { ticker: 'NVDA' }, outputSummary: null, status: 'completed' },
        { callIndex: 2, toolName: 'lookup_news', args: {}, outputSummary: null, status: 'completed' },
      ],
      contextMapping,
      allowAdditionalTools: false,
    });

    expect(result.blockedBy).toContain('additional_tools_not_allowed');
    expect(result.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'extra', reasons: ['additional_tools_not_allowed'] }),
    ]));
  });

  it('fails flex mode when observed args still use stale baseline values', () => {
    const result = evaluateToolReplayEnforcement({
      mode: 'replay_flex',
      expectedSteps,
      observedToolTrace: [
        { callIndex: 1, toolName: 'search_financials', args: { ticker: 'AAPL' }, outputSummary: null, status: 'completed', purpose: 'load earnings' },
      ],
      contextMapping,
      allowAdditionalTools: true,
    });

    expect(result.blockedBy).toContain('stale_context_value_in_tool_args');
    expect(result.comparisons).toEqual([
      expect.objectContaining({ status: 'failed', reasons: expect.arrayContaining(['stale_context_value_in_tool_args']) }),
    ]);
  });

  it('passes flex mode when an equivalent tool matches by purpose', () => {
    const result = evaluateToolReplayEnforcement({
      mode: 'replay_flex',
      expectedSteps,
      observedToolTrace: [
        { callIndex: 1, toolName: 'knowledge_lookup', purpose: 'load earnings', args: { ticker: 'NVDA' }, outputSummary: null, status: 'completed' },
      ],
      contextMapping,
      allowAdditionalTools: true,
    });

    expect(result.blockedBy).toEqual([]);
    expect(result.comparisons).toEqual([
      expect.objectContaining({ status: 'matched', observedToolName: 'knowledge_lookup', reasons: [] }),
    ]);
  });

  it('warns but does not fail adaptive mode on an alternative tool', () => {
    const result = evaluateToolReplayEnforcement({
      mode: 'replay_adaptive',
      expectedSteps,
      observedToolTrace: [
        { callIndex: 1, toolName: 'knowledge_lookup', args: { ticker: 'NVDA' }, outputSummary: null, status: 'completed' },
      ],
      contextMapping,
      allowAdditionalTools: true,
    });

    expect(result.blockedBy).toEqual([]);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'missing_required_tool', severity: 'warning' }),
      expect.objectContaining({ reason: 'additional_tools_not_allowed', severity: 'warning' }),
    ]));
  });
});
