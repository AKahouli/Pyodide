/**
 * Slug derivation shared by the agent and humain-agent services. Mirrors the
 * agent schema's slug format: accent-folded, lowercased, dash-separated.
 */
export function deriveAgentSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[ \t\n\r\f\v]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
