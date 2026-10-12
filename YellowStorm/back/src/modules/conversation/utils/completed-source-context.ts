import type { MessageComponent } from '../interfaces/message.interface';

/** Preserve public web citation identity with completed text, not raw tool responses. */
export function completedSourceContext(components: MessageComponent[]): string {
  const candidates: Array<{ reference: string; title: string; url: string }> = [];
  for (const component of components) {
    const data = component.data;
    if (component.type === 'citation' && (data.sourceType === 'web' || data.sourceKind === 'web')) {
      candidates.push({ reference: String(data.reference ?? '').slice(0, 80), title: String(data.title ?? '').slice(0, 240), url: String(data.source ?? '') });
    } else if (component.type === 'sources' && Array.isArray(data.sources)) {
      for (const source of data.sources) {
        if (source && typeof source === 'object') candidates.push({ reference: '', title: String(source.title ?? '').slice(0, 240), url: String(source.url ?? '') });
      }
    }
  }
  const sources: typeof candidates = [];
  const seen = new Set<string>();
  let size = 0;
  let omitted = 0;
  for (const source of candidates) {
    let url: URL;
    try { url = new URL(source.url); } catch { continue; } // Non-URL citation forms are not web provenance.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || source.url.length > 1500) continue;
    const key = `${source.reference}\n${source.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const length = JSON.stringify(source).length;
    if (sources.length >= 32 || size + length > 7600) { omitted++; continue; }
    sources.push(source); size += length;
  }
  return sources.length ? '\n\nSource references for this completed answer (metadata, not new findings):\n'
    + JSON.stringify({ sources, omitted_count: omitted }) : '';
}
