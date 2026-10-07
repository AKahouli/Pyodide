import { describe, expect, it } from 'vitest';
import type { SemanticRelationType } from '../types';
import { cardinalityOf, relationSentence, relationSides } from './relation-sentence';

const relation = (cardinality: SemanticRelationType['cardinality']): SemanticRelationType => ({
  id: 'r', key: 'belongs_to', label: 'belongs to', inverseLabel: 'has', description: '', sourceNodeTypeId: 'contract',
  targetNodeTypeId: 'customer', cardinality, traversable: true, filterable: true, attributes: [],
});
const t = (key: string, options?: Record<string, unknown>) => `${key}|${options?.subject}|${options?.verb}|${options?.object}`;

describe('relation sentences', () => {
  it('reads each cardinality as two sentences and back', () => {
    expect(relationSides('many_to_one')).toEqual({ forward: 'one', reverse: 'many' });
    expect(relationSides('one_to_many')).toEqual({ forward: 'many', reverse: 'one' });
    for (const value of ['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'] as const) {
      const { forward, reverse } = relationSides(value);
      expect(cardinalityOf(reverse, forward)).toBe(value);
    }
  });

  it('phrases the relationship from either concept', () => {
    const labels = { source: 'Contract', target: 'Customer' };
    expect(relationSentence(relation('many_to_one'), labels, 'contract', t)).toBe('relationSentence.sentence_one|Contract|belongs to|Customer');
    expect(relationSentence(relation('many_to_one'), labels, 'customer', t)).toBe('relationSentence.sentence_many|Customer|has|Contract');
  });
});
