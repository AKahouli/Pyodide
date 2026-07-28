import { Types } from 'mongoose';
import { ResponseReliabilityEvidenceBuilder } from './response-reliability-evidence.builder';

describe('ResponseReliabilityEvidenceBuilder', () => {
  const builder = new ResponseReliabilityEvidenceBuilder();

  it('extracts text and associates citation excerpts with their parent', () => {
    const message = {
      _id: new Types.ObjectId(),
      components: [
        { id: 'text-1', type: 'text', data: { content: 'Revenue was 10.' } },
        { id: 'reasoning-1', type: 'reasoning', data: { content: 'Private reasoning' } },
        { type: 'citation', data: { parentId: 'text-1', highlightText: 'Revenue was 10.', pageContent: 'fallback', source: 'report.pdf', page: '2' } },
      ],
    } as never;
    const result = builder.build(message, 'What was revenue?', 'request-1');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].evidence[0]).toMatchObject({ content: 'Revenue was 10.', source: 'report.pdf', page: '2' });
    expect(JSON.stringify(result)).not.toContain('Private reasoning');
  });

  it('uses orphan citations and successful sandbox output as global evidence', () => {
    const message = {
      _id: new Types.ObjectId(),
      components: [
        { type: 'text', data: { content: 'Result is 4.' } },
        { type: 'citation', data: { parentId: 'missing', page_content: 'External excerpt' } },
        { type: 'sandbox', data: { output_available: true, code: '2 + 2', output: '4' } },
        { type: 'sandbox', data: { outputAvailable: true, output: 'ignored', error: 'failed' } },
      ],
    } as never;
    const result = builder.build(message, 'Calculate', 'request-2');
    expect(result.segments[0].componentId).toBe('text-index-0');
    expect(result.globalEvidence).toHaveLength(2);
    expect(result.globalEvidence[1].content).toContain('Output:\n4');
    expect(result.globalEvidence[1].content).not.toContain('2 + 2');
  });

  it('builds candidate evidence only from supplied replay components', () => {
    const input = new ResponseReliabilityEvidenceBuilder().buildFromComponents({
      messageId: 'message-1', question: 'Question?', requestId: 'replay-1',
      components: [
        { id: 'text-new', type: 'text', data: { content: 'Replay answer' } },
        { id: 'citation-new', type: 'citation', data: { parentId: 'text-new', content: 'Replay evidence' } },
      ],
    });
    expect(input.segments[0].evidence).toEqual([expect.objectContaining({ content: 'Replay evidence' })]);
    expect(JSON.stringify(input)).not.toContain('Original evidence');
  });

  it('accepts completed allowlisted retrieval and calculator results', () => {
    const result = builder.buildFromComponents({
      messageId: 'message-1', question: 'Question?', requestId: 'replay-2',
      components: [
        { id: 'text', type: 'text', data: { content: 'Revenue was 10 and 2 + 2 is 4.' } },
        { id: 'search', type: 'toolInfo', data: {
          title: 'perform_document_search', status: 'completed',
          resultJson: JSON.stringify({ sources_text: [{ page_content: 'Revenue was 10.', filename: 'report.pdf', page: '2', source_reference: '[1]' }] }),
        } },
        { id: 'web', type: 'toolInfo', data: {
          title: 'perform_web_search', status: 'completed',
          resultJson: JSON.stringify({ text: 'Published result', sources: [{ title: 'Source', url: 'https://example.com/result' }] }),
        } },
        { id: 'calculator', type: 'toolInfo', data: { title: 'calculator', status: 'completed', resultJson: JSON.stringify('4') } },
      ] as never,
    });

    expect(result.globalEvidence).toEqual([
      expect.objectContaining({ type: 'document', content: 'Revenue was 10.', source: 'report.pdf', page: '2', reference: '[1]' }),
      expect.objectContaining({ type: 'document', content: expect.stringContaining('https://example.com/result') }),
      expect.objectContaining({ type: 'calculation', content: 'Output:\n4' }),
    ]);
  });

  it('rejects failed, malformed, oversized, insecure, and non-allowlisted tool results', () => {
    const result = builder.buildFromComponents({
      messageId: 'message-1', question: 'Question?', requestId: 'replay-3',
      components: [
        { id: 'text', type: 'text', data: { content: 'Answer' } },
        { id: 'failed', type: 'toolInfo', data: { title: 'perform_document_search', status: 'failed', resultJson: '{"sources_text":[{"page_content":"bad"}]}' } },
        { id: 'malformed', type: 'toolInfo', data: { title: 'perform_document_search', status: 'completed', resultJson: '{' } },
        { id: 'large', type: 'toolInfo', data: { title: 'perform_document_search', status: 'completed', resultJson: 'x'.repeat(65_537) } },
        { id: 'web', type: 'toolInfo', data: { title: 'perform_web_search', status: 'completed', resultJson: JSON.stringify({ text: 'Result', sources: [{ url: 'http://example.com' }] }) } },
        { id: 'other', type: 'toolInfo', data: { title: 'activate_skill', status: 'completed', resultJson: '{"secret":"value"}' } },
      ] as never,
    });
    expect(result.globalEvidence).toEqual([]);
  });
});
