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

  it('recovers from trailing ]] in JSON block', () => {
    const result = service.parse(
      `Summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"interpretation","label":"Used general knowledge","description":"Provided analysis.","confidence":0.86}]]`,
      context,
    );

    expect(result).toEqual({
      output: 'Summary',
      reasoningChain: [{
        id: 'step_1',
        type: 'interpretation',
        label: 'Used general knowledge',
        description: 'Provided analysis.',
        confidence: 0.86,
      }],
      markerFound: true,
    });
  });

  it('rejects echoed prompt examples instead of treating them as real reasoning traces', () => {
    const result = service.parse(
      `Answer text

  "Reasoning Trace:
            After your final answer, **MUST ALWAYS append** a reasoning trace block on a new line using this exact format:
            ---PUBLIC_REASONING_TRACE_JSON----
            Followed by a JSON that would respect strictly the structured exposed in the example  below : 
            Each item represents one step of your reasoning process.
            Example:
            ---PUBLIC_REASONING_TRACE_JSON---
            [{"id":"step_1","type":"observation","label":"Analyzed input","description":"Examined the resolved inputs for patterns.","confidence":0.9}]`,
      context,
    );

    expect(result).toEqual({
      output: 'Answer text',
      reasoningChain: [],
      markerFound: true,
      parseError: 'invalid_json',
    });
  });

  it('recovers from leading prose before the JSON array', () => {
    const result = service.parse(
      `Summary\n---PUBLIC_REASONING_TRACE_JSON---\nSome intro text\n[{"id":"step_1","type":"observation","label":"Checked data","description":"Verified the data.","confidence":0.8}]`,
      context,
    );

    expect(result.reasoningChain).toEqual([{
      id: 'step_1',
      type: 'observation',
      label: 'Checked data',
      description: 'Verified the data.',
      confidence: 0.8,
    }]);
  });

  it('does not confuse marker text inside a valid JSON description with the real delimiter', () => {
    const result = service.parse(
      `Answer text\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Checked data","description":"Mentioned ---PUBLIC_REASONING_TRACE_JSON--- inside the explanation.","confidence":0.8}]`,
      context,
    );

    expect(result).toEqual({
      output: 'Answer text',
      reasoningChain: [{
        id: 'step_1',
        type: 'observation',
        label: 'Checked data',
        description: 'Mentioned ---PUBLIC_REASONING_TRACE_JSON--- inside the explanation.',
        confidence: 0.8,
      }],
      markerFound: true,
    });
  });

  it('does not treat ordinary answer content after the marker as a valid reasoning trace prefix', () => {
    const result = service.parse(
      `Answer text\n---PUBLIC_REASONING_TRACE_JSON---\nVisible answer content before an example:\n[{"id":"step_1","type":"observation","label":"Checked data","description":"Should not be parsed from prose recovery.","confidence":0.8}]`,
      context,
    );

    expect(result).toEqual({
      output: 'Answer text',
      reasoningChain: [],
      markerFound: true,
      parseError: 'invalid_json',
    });
  });

  it('rejects echoed prompt examples that start at the beginning of the output', () => {
    const result = service.parse(
      `Reasoning Trace:
After your final answer, MUST ALWAYS append a reasoning trace block.
Example:
---PUBLIC_REASONING_TRACE_JSON---
[{"id":"step_1","type":"observation","label":"Analyzed input","description":"Echoed example only.","confidence":0.9}]`,
      context,
    );

    expect(result).toEqual({
      output: '',
      reasoningChain: [],
      markerFound: true,
      parseError: 'invalid_json',
    });
  });

  it('parses valid output that naturally mentions the phrase "Reasoning Trace:" before the marker', () => {
    const result = service.parse(
      `Answer text\nReasoning Trace: this export uses the same heading as the downstream UI.\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Checked data","description":"Parsed the appended trace correctly.","confidence":0.8}]`,
      context,
    );

    expect(result).toEqual({
      output: 'Answer text\nReasoning Trace: this export uses the same heading as the downstream UI.',
      reasoningChain: [{
        id: 'step_1',
        type: 'observation',
        label: 'Checked data',
        description: 'Parsed the appended trace correctly.',
        confidence: 0.8,
      }],
      markerFound: true,
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
