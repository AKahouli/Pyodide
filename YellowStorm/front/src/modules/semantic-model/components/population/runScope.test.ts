import { describe, expect, it } from 'vitest';
import { conceptsRefreshedWith } from './runScope';

describe('conceptsRefreshedWith', () => {
  const derived = [
    { conceptId: 'correspondant', sourceConceptId: 'participation' },
    { conceptId: 'fait', sourceConceptId: 'message' },
    { conceptId: 'contact', sourceConceptId: 'correspondant' },
  ];

  it('keeps the concept and the ones made from it, down the chain', () => {
    expect(conceptsRefreshedWith('participation', derived).sort()).toEqual(['contact', 'correspondant', 'participation']);
  });

  it('leaves out concepts made from unrelated records', () => {
    expect(conceptsRefreshedWith('participation', derived)).not.toContain('fait');
    expect(conceptsRefreshedWith('message', derived).sort()).toEqual(['fait', 'message']);
  });

  it('is only the concept itself when nothing is made from it', () => {
    expect(conceptsRefreshedWith('contact', derived)).toEqual(['contact']);
    expect(conceptsRefreshedWith('participation', [])).toEqual(['participation']);
  });
});
