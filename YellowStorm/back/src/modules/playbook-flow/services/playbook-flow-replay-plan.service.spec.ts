import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

describe('PlaybookFlowReplayPlanService', () => {
  let service: PlaybookFlowReplayPlanService;

  beforeEach(() => {
    service = new PlaybookFlowReplayPlanService();
  });

  it('builds replay flex planning from baseline and input context', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 3,
      intentKey: 'earnings.summary',
      intentLabel: 'Summarize earnings changes',
      taskTitle: 'Summarize Q1 earnings',
      taskDescription: 'Compare earnings and write a concise summary.',
      inputContext: {
        ticker: 'NVDA',
        dateWindow: 'Q1 2026',
      },
      contextVariableSchema: [
        { key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true },
        { key: 'taskTitle', label: 'Task Title', source: 'task', valueType: 'string', required: true },
      ],
      reasoningOutline: [
        { stageKey: 'extract', stageType: 'analysis', label: 'Extract data', description: 'Load the relevant figures.' },
      ],
      toolTraceTemplate: [
        { stepIndex: 1, toolName: 'search_financials', purpose: 'load earnings', argumentShape: { ticker: 'string', dateWindow: 'string' }, required: true },
      ],
      toolCalls: [
        { callIndex: 1, toolName: 'search_financials', args: { ticker: 'AAPL', dateWindow: 'Q4 2025' } },
      ],
      outputFormatGuide: 'Return sections Summary and Risks.',
      outputContract: {
        requiredSections: ['Summary'],
        forbiddenSections: ['Appendix'],
        citationPolicy: 'required',
      },
    });

    expect(result.intentKey).toBe('earnings.summary');
    expect(result.contextMapping).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'ticker',
        variableKey: 'ticker',
        baselineValue: null,
        currentValue: 'NVDA',
        value: 'NVDA',
        matched: true,
        confidence: 1,
        reason: 'matched_input_context',
      }),
      expect.objectContaining({
        key: 'taskTitle',
        currentValue: 'Summarize Q1 earnings',
        value: 'Summarize Q1 earnings',
        matched: true,
        confidence: 1,
        reason: 'matched_task_title',
      }),
    ]));
    expect(result.executionPlan.requiredStageLabels).toEqual(['Extract data']);
    expect(result.executionPlan.plannedToolSteps).toEqual([
      expect.objectContaining({
        toolName: 'search_financials',
        argumentShapeKeys: ['ticker', 'dateWindow'],
        expectedArgs: { ticker: 'NVDA', dateWindow: 'Q4 2025' },
        sourceCallIndex: 1,
      }),
    ]);
    expect(result.executionPlan.semanticChecklist).toEqual([]);
    expect(result.executionPlan.requiredOutputChecks).toContain('Include section: Summary');
    expect(result.executionPlan.requiredOutputChecks).toContain('Do not include section: Appendix');
  });

  it('marks missing required context values', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 1,
      contextVariableSchema: [
        { key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true },
      ],
    });

    expect(result.contextMapping).toEqual([
      expect.objectContaining({
        key: 'ticker',
        currentValue: null,
        value: null,
        matched: false,
        confidence: 0,
        reason: 'deterministic_mapping_not_found',
      }),
    ]);
    expect(result.executionPlan.missingRequiredContextCount).toBe(1);
  });

  it('preserves structured input context values for array and object variables', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 4,
      inputContext: {
        filters: ['quarterly', 'regional'],
        customerProfile: {
          region: 'EMEA',
          tier: 'enterprise',
        },
      },
      contextVariableSchema: [
        { key: 'filters', label: 'Filters', source: 'input_context', valueType: 'array', required: true },
        { key: 'customer_profile', label: 'Customer Profile', source: 'input_context', valueType: 'object', required: true },
      ],
    });

    expect(result.contextMapping).toEqual([
      expect.objectContaining({
        key: 'filters',
        currentValue: ['quarterly', 'regional'],
        value: ['quarterly', 'regional'],
        matched: true,
      }),
      expect.objectContaining({
        key: 'customer_profile',
        currentValue: { region: 'EMEA', tier: 'enterprise' },
        value: { region: 'EMEA', tier: 'enterprise' },
        matched: true,
      }),
    ]);
    expect(result.executionPlan.missingRequiredContextCount).toBe(0);
  });

  it('uses baseline example values and deterministic task-text extraction for obvious substitutions', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 5,
      taskTitle: 'Compare NVDA earnings for Q1 2026',
      taskDescription: 'Use request ID ABC-12345 and summarize Jensen Huang commentary.',
      contextVariableSchema: [
        { key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true, exampleValue: 'AAPL' },
        { key: 'dateWindow', label: 'Date Window', source: 'input_context', valueType: 'string', required: true, exampleValue: 'Q4 2025' },
        { key: 'requestId', label: 'Request ID', source: 'input_context', valueType: 'string', required: true, exampleValue: 'ABC-00000' },
      ],
    });

    expect(result.contextMapping).toEqual(expect.arrayContaining([
      expect.objectContaining({ baselineValue: 'AAPL', currentValue: 'NVDA', reason: 'matched_task_text_ticker', confidence: 0.95 }),
      expect.objectContaining({ baselineValue: 'Q4 2025', currentValue: 'Q1 2026', reason: 'matched_task_text_date', confidence: 0.9 }),
      expect.objectContaining({ baselineValue: 'ABC-00000', currentValue: 'ABC-12345', reason: 'matched_task_text_identifier', confidence: 0.85 }),
    ]));
    expect(service.hasUnresolvedRequiredContext(result.contextMapping)).toBe(false);
  });

  it('instantiates semantic checklist descriptions with current context values', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 1,
      inputContext: { ticker: 'NVDA' },
      contextVariableSchema: [
        { key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true, exampleValue: 'AAPL' },
      ],
      semanticChecklist: [
        { key: 'context:ticker', description: 'Use Ticker: AAPL.', variables: ['ticker'], severity: 'fail', source: 'context' },
      ],
    });

    expect(result.executionPlan.semanticChecklist).toEqual([
      expect.objectContaining({ description: 'Use Ticker: NVDA.' }),
    ]);
  });

  it('does not reuse args from a positional baseline tool call when the tool names differ', () => {
    const result = service.buildReplayPlanning({
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 1,
      toolTraceTemplate: [
        { stepIndex: 1, toolName: 'search_financials', purpose: 'load earnings', argumentShape: { ticker: 'string' }, required: true },
      ],
      toolCalls: [
        { callIndex: 1, toolName: 'summarize', args: { format: 'bullet' } },
      ],
    });

    expect(result.executionPlan.plannedToolSteps).toEqual([
      expect.objectContaining({ expectedArgs: {}, sourceCallIndex: null }),
    ]);
  });
});
