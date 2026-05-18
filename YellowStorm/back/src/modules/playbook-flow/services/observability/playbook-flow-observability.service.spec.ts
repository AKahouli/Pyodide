import { PlaybookFlowObservabilityService } from './playbook-flow-observability.service';
import { PlaybookFlowTraceRedactionService } from './playbook-flow-trace-redaction.service';

describe('PlaybookFlowObservabilityService', () => {
  const service = new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService());

  it('normalizes and redacts observability payloads', () => {
    const payload = service.extractCompletedResultPayload({
      output: 'done',
      tool_trace: [{
        call_index: 0,
        tool_name: 'search',
        args: { authorization: 'Bearer abc', query: 'hello' },
        output_summary: 'result',
        status: 'completed',
        duration_ms: 10,
      }],
      llm_prompt_trace: [{ stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Bearer secret' }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, model: 'gpt-4o-mini' },
      semantic_match: { match_score: 0.9, missing_points: ['none'] },
      trace_metadata: { token: '123', safe: true },
    }, { executionId: 'exec-1', taskId: 'task-1' });

    expect(payload.toolTrace).toEqual([{
      callIndex: 0,
      toolName: 'search',
      args: { authorization: '[REDACTED]', query: 'hello' },
      outputSummary: 'result',
      status: 'completed',
      durationMs: 10,
      error: null,
    }]);
    expect(payload.llmPromptTrace).toEqual([
      { stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Bearer [REDACTED]' },
    ]);
    expect(payload.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' });
    expect(payload.semanticMatch).toEqual(expect.objectContaining({ matchScore: 0.9, missingPoints: ['none'], changedPoints: [] }));
    expect(payload.traceMetadata).toEqual({ token: '[REDACTED]', safe: true });
  });
});
