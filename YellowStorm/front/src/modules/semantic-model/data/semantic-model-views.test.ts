import { describe, expect, it } from 'vitest';
import { FIRST_TIME_CHECKLIST, VIEW_TO_MODE, viewPrerequisite } from './semantic-model-views';
import { readKey, resolveReadKind } from './semantic-model-read.provider';

describe('semantic-model views (P1.10/P1.14)', () => {
  it('maps four business views onto existing editor modes without a rewrite', () => {
    expect(VIEW_TO_MODE.model).toBe('structure');
    expect(VIEW_TO_MODE.sources).toBe('mappings');
    expect(VIEW_TO_MODE.data).toBe('records');
  });

  it('gates unavailable views with a prerequisite instead of empty success', () => {
    expect(viewPrerequisite('sources', { hasConcepts: false, hasSources: false, hasData: false }).met).toBe(false);
    expect(viewPrerequisite('data', { hasConcepts: true, hasSources: false, hasData: false }).met).toBe(false);
    expect(viewPrerequisite('test', { hasConcepts: true, hasSources: true, hasData: true }).met).toBe(true);
  });

  it('keeps the first-time checklist to five onboarding steps', () => {
    expect(FIRST_TIME_CHECKLIST).toHaveLength(5);
  });

  it('fails closed on unclassified calls and scopes cache keys', () => {
    expect(resolveReadKind('semanticModelApi.validate')).toBe('unclassified');
    expect(resolveReadKind('validate')).toBe('command');
    expect(resolveReadKind('graph')).toBe('curated-read');
    expect(resolveReadKind('nope')).toBe('unclassified');
    expect(
      readKey({ view: 'data', kind: 'curated-read', modelId: 'm', modelVersionId: 'v', dataRevisionId: 'd' }),
    ).toEqual(['semantic-model', 'data', 'm', 'v', 'd']);
  });
});
