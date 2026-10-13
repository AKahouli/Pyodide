import { fieldGraphProblems, graphExposureOf, pickFieldGraph } from './semantic-graph-exposure';
import { parseSemanticGraphOperation } from './semantic-graph-operation.parser';

const field = (graph: unknown) => ({
  type: 'node_type.update', id: '00000000-0000-4000-8000-000000000001',
  changes: { attributes: [{ key: 'body', label: 'Body', type: 'text', required: false, graph }] },
});

describe('field graph settings', () => {
  it('accepts a hidden field and a cut text, and refuses anything else', () => {
    expect(fieldGraphProblems({ expose: false })).toEqual([]);
    expect(fieldGraphProblems({ expose: true, maxChars: 500 })).toEqual([]);
    expect(fieldGraphProblems('no')).toEqual(['graph: must be an object']);
    expect(fieldGraphProblems({ expose: 'no' })).toEqual(['graph: expose must be true or false']);
    expect(fieldGraphProblems({ maxChars: 10 })[0]).toMatch(/maxChars must be a whole number from 50 to 100000/);
    expect(fieldGraphProblems({ maxChars: 1.5 })).toHaveLength(1);
    expect(fieldGraphProblems({ maxChars: 100001 })).toHaveLength(1);
    expect(fieldGraphProblems({ other: 1 })).toEqual(['graph: other is not a setting']);
  });

  it('is validated where a concept is saved', () => {
    expect(() => parseSemanticGraphOperation(field({ expose: false, maxChars: 300 }) as never)).not.toThrow();
    expect(() => parseSemanticGraphOperation(field(null) as never)).not.toThrow();
    expect(() => parseSemanticGraphOperation(field({ expose: 'x' }) as never)).toThrow(/attribute.graph/);
    expect(() => parseSemanticGraphOperation(field({ maxChars: 5 }) as never)).toThrow(/attribute.graph/);
    expect(() => parseSemanticGraphOperation(field({ unknown: true }) as never)).toThrow(/not a setting/);
  });

  it('stores nothing for the defaults', () => {
    expect(pickFieldGraph({ expose: true })).toBeUndefined();
    expect(pickFieldGraph({})).toBeUndefined();
    expect(pickFieldGraph({ expose: false, maxChars: 200 })).toEqual({ expose: false, maxChars: 200 });
    expect(pickFieldGraph({ expose: 'x' })).toBeUndefined();
  });

  it('builds the exposure the runtime applies: hidden fields, and cuts on texts that stay', () => {
    const nodes = [
      { id: 'c1', attributes: [
        { key: 'a', label: 'A', type: 'text', required: false, graph: { expose: false, maxChars: 100 } },
        { key: 'b', label: 'B', type: 'text', required: false, graph: { maxChars: 300 } },
        { key: 'n', label: 'N', type: 'number', required: false, graph: { maxChars: 300 } },
        { key: 'c', label: 'C', type: 'text', required: false },
      ] },
      { id: 'c2', attributes: [{ key: 'x', label: 'X', type: 'text', required: false, graph: { expose: true } }] },
      { id: 'c3', attributes: null },
    ];
    expect(graphExposureOf(nodes as never)).toEqual({ c1: { hidden: ['a'], maxChars: { b: 300 } } });
    expect(graphExposureOf([])).toEqual({});
  });
});
