import { describe, expect, it } from 'vitest';
import { isTemplateRevisionId } from './template-revision';

describe('isTemplateRevisionId', () => {
  it('matches template_<id> revisions', () => {
    expect(isTemplateRevisionId('template_abc123')).toBe(true);
  });

  it('rejects system starters and empty values', () => {
    expect(isTemplateRevisionId('starter_react_vite_v6')).toBe(false);
    expect(isTemplateRevisionId('')).toBe(false);
    expect(isTemplateRevisionId(null)).toBe(false);
    expect(isTemplateRevisionId(undefined)).toBe(false);
  });
});
