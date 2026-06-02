import { PlaybookFlowObservabilityService } from './playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './playbook-flow-trace-redaction.service';

describe('PlaybookFlowObservabilityService', () => {
  const service = new PlaybookFlowObservabilityService(
    new PlaybookFlowTraceRedactionService(),
    new PlaybookFlowPublicReasoningParserService(),
  );

  it('normalizes and redacts observability payloads', () => {
    const payload = service.extractCompletedResultPayload({
      output: 'done\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer.","confidence":0.9}]',
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

    expect(payload.output).toBe('done');
    expect(payload.reasoningChain).toEqual([{
      id: 'step_1',
      type: 'observation',
      label: 'Identify',
      description: 'Picked the answer.',
      confidence: 0.9,
    }]);
    expect(payload.toolTrace).toEqual([{
      callIndex: 0,
      toolName: 'search',
      args: { authorization: '[REDACTED]', query: 'hello' },
      outputSummary: 'result',
      status: 'completed',
      durationMs: 10,
      purpose: null,
      error: null,
    }]);
    expect(payload.llmPromptTrace).toEqual([
      { stage: 'initial_request', model: 'gpt-4o-mini', prompt: 'Bearer [REDACTED]' },
    ]);
    expect(payload.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-4o-mini' });
    expect(payload.semanticMatch).toEqual(expect.objectContaining({ matchScore: 0.9, missingPoints: ['none'], changedPoints: [] }));
    expect(payload.traceMetadata).toEqual({
      token: '[REDACTED]',
      safe: true,
      publicReasoning: { markerFound: true, parseError: undefined, itemCount: 1 },
    });
    expect(service.toStreamPayload(payload)).toEqual(expect.objectContaining({
      reasoningChain: [{
        id: 'step_1',
        type: 'observation',
        label: 'Identify',
        description: 'Picked the answer.',
        confidence: 0.9,
      }],
    }));
  });

  it('cleans display text when only display_text carries the marker', () => {
    const payload = service.extractCompletedResultPayload({
      output: { final: 'done' },
      display_text: 'Visible summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer."}]',
    }, { executionId: 'exec-1', taskId: 'task-1' });

    expect(payload.output).toBe('Visible summary');
    expect(payload.displayText).toBe('Visible summary');
    expect(payload.reasoningChain).toEqual([{
      id: 'step_1',
      type: 'observation',
      label: 'Identify',
      description: 'Picked the answer.',
    }]);
  });

  it('extracts reasoning from reasoning_trace for structured-output steps', () => {
    const payload = service.extractCompletedResultPayload({
      output: 'Summary text',
      display_text: 'Summary text',
      reasoning_trace: [{ id: 's1', type: 'analysis', label: 'Checked', description: 'Verified.' }],
      outputs: { out1: { output_port_id: 'out1', artifact_kind: 'text', content: 'result' } },
    }, { executionId: 'exec-1', taskId: 'task-1' });

    expect(payload.output).toBe('Summary text');
    expect(payload.displayText).toBe('Summary text');
    expect(payload.reasoningChain).toEqual([{
      id: 's1',
      type: 'analysis',
      label: 'Checked',
      description: 'Verified.',
    }]);
  });

  it('falls back to raw_llm_output parsing when reasoning_trace is absent', () => {
    const payload = service.extractCompletedResultPayload({
      output: 'Summary text',
      raw_llm_output: 'Summary text\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"s2","type":"observation","label":"Looked","description":"Checked data."}]',
    }, { executionId: 'exec-1', taskId: 'task-1' });

    expect(payload.output).toBe('Summary text');
    expect(payload.reasoningChain).toEqual([{
      id: 's2',
      type: 'observation',
      label: 'Looked',
      description: 'Checked data.',
    }]);
  });

  it('normalizes in-band reasoning_trace items and drops invalid ones', () => {
    const payload = service.extractCompletedResultPayload({
      output: 'Summary text',
      display_text: 'Summary text',
      reasoning_trace: [
        { id: 's1', type: 'analysis', label: 'Valid', description: 'Good item.' },
        { id: '', type: 'analysis', label: 'Missing id', description: 'Dropped.' },
        { type: 'analysis', label: 'No id', description: 'Also dropped.' },
        { id: 's4', type: 'analysis', label: 'Valid too', description: 'Second good.', confidence: 0.8 },
        { id: 's5', type: 'bad', label: 'Bad confidence', description: 'Wrong.', confidence: 5.0 },
      ],
      outputs: { out1: { output_port_id: 'out1', artifact_kind: 'text', content: 'result' } },
    }, { executionId: 'exec-1', taskId: 'task-1' });

    expect(payload.reasoningChain).toEqual([
      { id: 's1', type: 'analysis', label: 'Valid', description: 'Good item.' },
      { id: 's4', type: 'analysis', label: 'Valid too', description: 'Second good.', confidence: 0.8 },
    ]);
    expect((payload.traceMetadata as any)?.publicReasoning?.markerFound).toBe(false);
  });
});
