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
});
