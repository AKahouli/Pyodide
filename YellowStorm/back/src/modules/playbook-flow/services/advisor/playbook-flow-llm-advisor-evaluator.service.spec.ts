import { AxiosError } from 'axios';
import { PlaybookFlowLlmAdvisorEvaluatorService } from './playbook-flow-llm-advisor-evaluator.service';
import { describeLiteLlmHttpError } from '@modules/models/litellm-connection.service';

function buildAxiosError(status: number, data: unknown): AxiosError {
  const response = {
    status,
    statusText: 'Bad Request',
    data,
    headers: {},
    config: {},
  } as unknown as AxiosError['response'];
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    {} as AxiosError['config'],
    undefined,
    response,
  );
}

function buildEvaluator(httpClient: { post: jest.Mock }, omitTemperature = false) {
  return new PlaybookFlowLlmAdvisorEvaluatorService(
    { getHttpClient: () => httpClient } as any,
    { findByKey: jest.fn().mockResolvedValue(null) } as any,
    { render: jest.fn((_template: string) => _template) } as any,
    {
      resolveEvaluationModelConfig: jest.fn().mockResolvedValue({ model: 'test-model', omitTemperature }),
    } as any,
    { recordUsage: jest.fn() } as any,
    {} as any,
    { setContext: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as any,
  );
}

const baseParams = {
  executionId: 'exec-1',
  ownerId: 'owner-1',
  flowId: 'flow-1',
  node: { id: 'node-1', label: 'Task', kind: 'step', metadata: {} },
  taskResult: { output: 'task output', artifacts: [], toolTrace: [], llmPromptTrace: [], usage: null },
  expectedResult: null,
  outputFormatGuide: null,
  baselineOutput: null,
  workflowGoal: '',
  upstreamContextJson: '{}',
};

describe('PlaybookFlowLlmAdvisorEvaluatorService', () => {
  it.each([
    { omitTemperature: true, expectedTemperature: undefined },
    { omitTemperature: false, expectedTemperature: 0 },
  ])('uses the selected model temperature capability', async ({ omitTemperature, expectedTemperature }) => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: '{}' } }],
          usage: {},
        },
      }),
    };
    const evaluator = buildEvaluator(httpClient, omitTemperature);
    (evaluator as any).mapper = { mapLlmJudgeResult: jest.fn().mockReturnValue({}) };

    await evaluator.evaluate(baseParams);

    const request = httpClient.post.mock.calls[0][1];
    expect(request.temperature).toBe(expectedTemperature);
    expect(Object.hasOwn(request, 'temperature')).toBe(!omitTemperature);
  });

  it('surfaces the LiteLLM error body when the evaluation request fails', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue(buildAxiosError(400, {
        error: { message: 'Invalid model name passed in model=test-model', type: 'None' },
      })),
    };
    const evaluator = buildEvaluator(httpClient);

    await expect(evaluator.evaluate(baseParams)).rejects.toThrow(
      'Advisor evaluation LLM request failed (HTTP 400: Invalid model name passed in model=test-model)',
    );
  });

  it('describes plain network errors through the shared helper', () => {
    expect(describeLiteLlmHttpError(new Error('boom'))).toBe('boom');
    expect(describeLiteLlmHttpError('odd')).toBe('Unknown error');
  });
});
