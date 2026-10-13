import { TEMPLATE_SLUG_REGEX } from '../constants/template-catalog.constants';

/** Lowercase, accent-stripped, hyphen-separated slug derived from a display name. */
export function slugifyCategoryName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isValidTemplateSlug(slug: string): boolean {
  return TEMPLATE_SLUG_REGEX.test(slug);
}
