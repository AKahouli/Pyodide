import { deriveAgentSlug } from './slugify';

describe('deriveAgentSlug', () => {
  it('folds accents, spaces and symbols into a dash-separated slug', () => {
    expect(deriveAgentSlug('  Café  Rénovation Guide v2! ')).toBe('cafe-renovation-guide-v2');
  });

  it('keeps existing dashes and trims edge dashes', () => {
    expect(deriveAgentSlug('smart-memory--tools-')).toBe('smart-memory-tools');
  });
});
