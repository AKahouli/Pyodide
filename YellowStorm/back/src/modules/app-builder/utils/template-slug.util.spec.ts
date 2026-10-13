import { slugifyCategoryName, isValidTemplateSlug } from './template-slug.util';

describe('template-slug.util', () => {
  it('slugifies names with accents, spaces and punctuation', () => {
    expect(slugifyCategoryName('Modèles  Créatifs / 2026!')).toBe('modeles-creatifs-2026');
    expect(slugifyCategoryName('  Déjà-vu  ')).toBe('deja-vu');
  });

  it('validates kebab-case slugs only', () => {
    expect(isValidTemplateSlug('productivity')).toBe(true);
    expect(isValidTemplateSlug('data-apps-2026')).toBe(true);
    expect(isValidTemplateSlug('Bad Slug')).toBe(false);
    expect(isValidTemplateSlug('-leading')).toBe(false);
    expect(isValidTemplateSlug('UPPER')).toBe(false);
  });
});
