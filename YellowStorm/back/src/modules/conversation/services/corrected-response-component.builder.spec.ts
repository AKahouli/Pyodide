import { CorrectedResponseComponentBuilder } from './corrected-response-component.builder';

describe('CorrectedResponseComponentBuilder', () => {
  it('changes only known text content and preserves original components', () => {
    const original = [
      { id: 'text-1', type: 'text' as const, data: { content: 'Original' } },
      { id: 'citation-1', type: 'citation' as const, data: { reference: '1' } },
    ];
    const result = new CorrectedResponseComponentBuilder().build(
      original,
      [{ componentId: 'text-1', text: 'Original', evidence: [] }],
      [{ text: 'Corrected' }],
    );
    expect(result[0].data.content).toBe('Corrected');
    expect(result[1]).toBe(original[1]);
    expect(original[0].data.content).toBe('Original');
  });

  it('rejects changed segment counts and empty candidates', () => {
    const builder = new CorrectedResponseComponentBuilder();
    const original = [{ id: 'text-1', type: 'text' as const, data: { content: 'Original' } }];
    const segments = [{ componentId: 'text-1', text: 'Original', evidence: [] }];
    expect(() => builder.build(original, segments, [])).toThrow('segment count');
    expect(() => builder.build(original, segments, [{ text: ' ' }])).toThrow('empty segment');
  });
});
