import { PlaybookFlowReplaySemanticJudgeService } from './playbook-flow-replay-semantic-judge.service';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';

describe('PlaybookFlowReplaySemanticJudgeService', () => {
  function createService(llmOverrides?: { getHttpClient?: (() => any) | null }) {
    const httpClient = llmOverrides?.getHttpClient?.() ?? null;
    const liteLLMConnectionService = {
      getHttpClient: jest.fn().mockReturnValue(httpClient),
    };
    const modelService = { resolveEvaluationModel: jest.fn().mockResolvedValue('test-model') };
    const logger = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };

    const service = new PlaybookFlowReplaySemanticJudgeService(
      liteLLMConnectionService as any,
      modelService as any,
      logger as any,
    );

    return { service, liteLLMConnectionService, modelService, logger, httpClient };
  }

  const basePlanning: ReplayPlanningSummary = {
    replayId: 'replay-1',
    validationVersion: 1,
    intentKey: null,
    intentLabel: null,
    contextMapping: [
      { variableKey: 'ticker', key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true, baselineValue: 'AAPL', currentValue: 'MSFT', confidence: 1, reason: '', value: 'MSFT', matched: true },
    ],
    executionPlan: {
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 1,
      intentKey: null,
      intentLabel: null,
      matchedContextCount: 1,
      missingRequiredContextCount: 0,
      requiredStageLabels: [],
      requiredOutputChecks: [],
      plannedToolSteps: [],
      semanticChecklist: [
        { key: 'ticker-mentioned', description: 'Output mentions the ticker symbol', severity: 'warning', variables: ['ticker'], source: 'output_contract' },
        { key: 'analysis-depth', description: 'Output includes fundamental analysis', severity: 'info', variables: [], source: 'reasoning' },
      ],
    },
  };

  it('returns null when LiteLLM client is null', async () => {
    const { service } = createService({ getHttpClient: () => null });

    const result = await service.evaluate({
      output: 'MSFT analysis',
      planning: basePlanning,
      contextMappingJson: '{}',
    });

    expect(result).toBeNull();
  });

  it('returns null when dependencies are not injected', async () => {
    const service = new PlaybookFlowReplaySemanticJudgeService(null, null, null);

    const result = await service.evaluate({
      output: 'MSFT analysis',
      planning: basePlanning,
      contextMappingJson: '{}',
    });

    expect(result).toBeNull();
  });

  it('returns FlowTaskSemanticMatch with judgeUsed=true on successful LLM call', async () => {
    const postMock = jest.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content: JSON.stringify({
          preservedPoints: ['ticker-mentioned'],
          missingPoints: ['analysis-depth'],
          changedPoints: [],
          missingPointFindings: [{ key: 'analysis-depth', expected: 'Output includes fundamental analysis', observed: null, severity: 'info' }],
          staleContextReferenceFindings: [],
          unsupportedClaimFindings: [],
          overallScore: 70,
          reason: 'Ticker preserved but analysis depth missing.',
        })}}],
      },
    });

    const { service } = createService({ getHttpClient: () => ({ post: postMock }) });

    const result = await service.evaluate({
      output: 'MSFT shows strong momentum',
      planning: basePlanning,
      contextMappingJson: JSON.stringify(basePlanning.contextMapping),
    });

    expect(result).not.toBeNull();
    expect(result!.judgeUsed).toBe(true);
    expect(result!.model).toBe('test-model');
    expect(result!.matchScore).toBe(70);
    expect(result!.preservedPoints).toEqual(['ticker-mentioned']);
    expect(result!.missingPoints).toEqual(['analysis-depth']);
    expect(result!.evaluationSource).toBe('instantiated_replay');
    expect(postMock).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({
        model: 'test-model',
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it('returns null on LLM call failure (triggers deterministic fallback)', async () => {
    const postMock = jest.fn().mockRejectedValue(new Error('timeout'));
    const { service, logger } = createService({ getHttpClient: () => ({ post: postMock }) });

    const result = await service.evaluate({
      output: 'MSFT analysis',
      planning: basePlanning,
      contextMappingJson: '{}',
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Replay semantic judge failed'));
  });

  it('returns null on invalid JSON response', async () => {
    const postMock = jest.fn().mockResolvedValue({
      data: { choices: [{ message: { content: 'not json' } }] },
    });
    const { service } = createService({ getHttpClient: () => ({ post: postMock }) });

    const result = await service.evaluate({
      output: 'MSFT analysis',
      planning: basePlanning,
      contextMappingJson: '{}',
    });

    expect(result).toBeNull();
  });

  it('clamps overallScore to 0-100 range', async () => {
    const judgeOutput = JSON.stringify({
      preservedPoints: [],
      missingPoints: [],
      changedPoints: [],
      missingPointFindings: [],
      staleContextReferenceFindings: [],
      unsupportedClaimFindings: [],
      overallScore: 150,
      reason: 'Over-scored.',
    });
    const postMock = jest.fn().mockResolvedValue({
      data: { choices: [{ message: { content: judgeOutput } }] },
    });

    const { service } = createService({ getHttpClient: () => ({ post: postMock }) });

    const result = await service.evaluate({
      output: 'test',
      planning: basePlanning,
      contextMappingJson: '{}',
    });

    expect(result!.matchScore).toBe(100);
  });
});
