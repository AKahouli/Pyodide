import { PlaybookFlowPublicReasoningParserService } from './playbook-flow-public-reasoning-parser.service';

describe('PlaybookFlowPublicReasoningParserService', () => {
  const service = new PlaybookFlowPublicReasoningParserService();
  const context = { executionId: 'exec-1', taskId: 'task-1' };

  it('returns the original output when no marker exists', () => {
    expect(service.parse('Visible output', context)).toEqual({
      output: 'Visible output',
      reasoningChain: [],
      markerFound: false,
    });
  });

  it('strips the marker block and returns parsed reasoning', () => {
    const result = service.parse(`Summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify indicators","description":"Picked the indicators.","confidence":0.9}]`, context);

    expect(result).toEqual({
      output: 'Summary',
      reasoningChain: [{
        id: 'step_1',
        type: 'observation',
        label: 'Identify indicators',
        description: 'Picked the indicators.',
        confidence: 0.9,
      }],
      markerFound: true,
    });
  });

  it('does not throw on invalid JSON', () => {
    expect(service.parse('Summary\n---PUBLIC_REASONING_TRACE_JSON---\n{', context)).toEqual({
      output: 'Summary',
      reasoningChain: [],
      markerFound: true,
      parseError: 'invalid_json',
    });
  });

  it('does not throw when the JSON root is not an array', () => {
    expect(service.parse('Summary\n---PUBLIC_REASONING_TRACE_JSON---\n{"id":"step_1"}', context)).toEqual({
      output: 'Summary',
      reasoningChain: [],
      markerFound: true,
      parseError: 'json_root_not_array',
    });
  });

  it('drops invalid items and keeps valid ones', () => {
    const result = service.parse(`Summary\n---PUBLIC_REASONING_TRACE_JSON---\n[
      {"id":"valid","type":"observation","label":"Label","description":"Description"},
      {"id":"bad-confidence","type":"observation","label":"Label","description":"Description","confidence":2},
      {"id":"missing-description","type":"observation","label":"Label"}
    ]`, context);

    expect(result.reasoningChain).toEqual([{
      id: 'valid',
      type: 'observation',
      label: 'Label',
      description: 'Description',
    }]);
  });

  it('ignores oversized JSON blocks', () => {
    const oversizedDescription = 'a'.repeat((64 * 1024) + 1);
    const result = service.parse(
      `Summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Label","description":"${oversizedDescription}"}]`,
      context,
    );

    expect(result).toEqual({
      output: 'Summary',
      reasoningChain: [],
      markerFound: true,
      parseError: 'oversized_json_block',
    });
  });

  it('caps label and description lengths', () => {
    const result = service.parse(
      `Summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"${'l'.repeat(250)}","description":"${'d'.repeat(2500)}"}]`,
      context,
    );

    expect(result.reasoningChain).toHaveLength(1);
    expect(result.reasoningChain[0]?.label).toHaveLength(200);
    expect(result.reasoningChain[0]?.description).toHaveLength(2000);
  });
});
