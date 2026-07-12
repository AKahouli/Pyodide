/**
 * TypeScript reference renderers for the public embed widget SSE contract.
 * Mirror of `_ysRenderers` in `widget-template.ts` (vanilla JS runtime).
 * Supported component types: `text`, `sources`, `citation`, `choice`.
 */

import { widgetMarkdown } from './widget-markdown';

export interface WidgetSourceItem {
  title: string;
  url: string;
}

export interface WidgetSourcesData {
  sources: WidgetSourceItem[];
}

export interface WidgetCitationData {
  parentId: string;
  sourceType: 'text' | 'image';
  type?: string;
  source?: string;
  fileName?: string;
  page?: string;
  pageContent?: string;
  workspaceId?: string;
  workspaceName?: string;
  path?: string;
  reference?: string;
  highlightText?: string;
}

export type WidgetCitationFileEntry = {
  fileName?: string;
  url?: string;
  workspaceId?: string;
  reference?: string;
  page?: string;
  pageNum?: string;
  highlightText?: string;
};

function citationSourceTitle(url: string, sources: WidgetSourceItem[]): string {
  const citationUrl = url.trim();
  if (!citationUrl) return '';

  const source = sources.find(
    (item) => typeof item?.url === 'string' && item.url.trim() === citationUrl,
  );
  return typeof source?.title === 'string' ? source.title.trim() : '';
}

/** Renders markdown assistant text (`TextComponent.content`). */
export function renderText(data: Record<string, unknown>): string {
  const content = typeof data.content === 'string' ? data.content : '';
  if (!content.trim()) return '';
  return '<div class="ys-md-content">' + widgetMarkdown(content) + '</div>';
}

/** Renders collapsible web sources (`SourcesComponent.sources[]`). */
export function renderSources(data: Record<string, unknown>): string {
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (!sources.length) return '';

  const itemsHtml = sources
    .map((src: { title?: string; url?: string }) => {
      const title = typeof src.title === 'string' ? src.title : '';
      const rawUrl = typeof src.url === 'string' ? src.url : '';
      const url = safeHttpUrl(rawUrl);
      const label = sourceDisplayLabel(title, url);
      return (
        '<a class="ys-comp-source-item" href="' +
        escapeAttr(url) +
        '" target="_blank" rel="noopener noreferrer" title="' +
        escapeAttr(url) +
        '">' +
        bookIconSvg() +
        '<span>' +
        escapeHtml(label) +
        '</span></a>'
      );
    })
    .join('');

  return (
    '<div class="ys-comp-wrap ys-comp-sources">' +
    '<button type="button" class="ys-comp-sources-trigger" data-sources-toggle aria-expanded="false">' +
    globeIconSvg() +
    '<span class="ys-comp-sources-label">' +
    escapeHtml(sourcesLabel(sources.length)) +
    '</span>' +
    '<span class="ys-comp-sources-count" aria-hidden="true">' +
    sources.length +
    '</span>' +
    chevronIconSvg() +
    '</button>' +
    '<div class="ys-comp-sources-panel">' +
    itemsHtml +
    '</div></div>'
  );
}

/** Builds a clickable href for citation file links in the embed widget. */
export function buildCitationFileHref(source: string, path: string): string {
  const raw = source.trim() || path.trim();
  if (!raw) return '#';
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Normalizes citation reference markers like `[1]` → `1`. */
export function normalizeCitationReference(reference?: string): string {
  if (!reference) return '';
  return reference.trim().replace(/^\[|\]$/g, '').trim();
}

/** Extracts the last integer from a citation page field (e.g. `doc.pdf - page 5` → `5`). */
export function parseCitationPage(page?: string): string {
  if (!page) return '';
  const numbers = page.match(/\d+/g);
  return numbers?.length ? numbers[numbers.length - 1] : '';
}

/** Strips optional `<page …>` wrappers and normalizes highlight/page content text. */
export function extractHighlightText(raw?: string): string {
  if (!raw) return '';
  let working = raw.trim();
  if (!working) return '';
  working = working.replace(/^<page\b[^>]*>/i, '').replace(/<\/page>$/i, '');
  return working.replace(/\s+/g, ' ').trim();
}

/**
 * Ensures every citation has a numeric reference (`1`, `2`, …).
 * Preserves existing refs and fills gaps for citations that arrived without one.
 */
export function ensureCitationReferences(
  entries: WidgetCitationFileEntry[],
): WidgetCitationFileEntry[] {
  const used = new Set<string>();
  for (const entry of entries) {
    const ref = normalizeCitationReference(entry.reference);
    if (ref) used.add(ref);
  }

  let next = 1;
  return entries.map((entry) => {
    const existing = normalizeCitationReference(entry.reference);
    if (existing) {
      return { ...entry, reference: existing };
    }
    while (used.has(String(next))) next += 1;
    const reference = String(next);
    used.add(reference);
    next += 1;
    return { ...entry, reference };
  });
}

/** Sorts citations by numeric reference so badges always render as 1, 2, 3… */
export function sortCitationsByReference(
  entries: WidgetCitationFileEntry[],
): WidgetCitationFileEntry[] {
  return [...entries].sort((a, b) => {
    const left = parseInt(normalizeCitationReference(a.reference) || '0', 10);
    const right = parseInt(normalizeCitationReference(b.reference) || '0', 10);
    return left - right;
  });
}

/** Builds a clickable numbered citation badge. */
export function buildCitationBadgeHtml(
  entry: WidgetCitationFileEntry,
  sources: WidgetSourceItem[] = [],
): string {
  const fileName = typeof entry.fileName === 'string' ? entry.fileName : '';
  const url = typeof entry.url === 'string' ? entry.url : '';
  const source = url || fileName;
  const workspaceId = typeof entry.workspaceId === 'string' ? entry.workspaceId : '';
  const reference = normalizeCitationReference(entry.reference);
  const pageNum =
    (typeof entry.pageNum === 'string' && entry.pageNum) ||
    parseCitationPage(typeof entry.page === 'string' ? entry.page : '');
  const highlightText = extractHighlightText(
    typeof entry.highlightText === 'string' ? entry.highlightText : '',
  );
  const label = citationSourceTitle(url, sources) || reference || fileName || url || 'Source';
  const title = fileName ? (pageNum ? `${fileName} (p. ${pageNum})` : fileName) : label;

  if (!source && !reference) return '';

  return (
    '<a class="ys-comp-citation-link ys-comp-citation-badge" href="#" role="button" title="' +
    escapeAttr(title) +
    '"' +
    (source ? ' data-ys-source="' + escapeAttr(source) + '"' : '') +
    (fileName ? ' data-ys-filename="' + escapeAttr(fileName) + '"' : '') +
    (workspaceId ? ' data-ys-wsid="' + escapeAttr(workspaceId) + '"' : '') +
    (pageNum ? ' data-ys-page="' + escapeAttr(pageNum) + '"' : '') +
    (highlightText ? ' data-ys-highlight="' + escapeAttr(highlightText) + '"' : '') +
    '>' +
    escapeHtml(label) +
    '</a>'
  );
}

/**
 * Replaces `[n]` markers with clickable badges whenever a matching citation exists.
 * Matching requires a resolvable source (`url` or `fileName`).
 */
export function injectCitationMarkers(
  html: string,
  citations: WidgetCitationFileEntry[],
  sources: WidgetSourceItem[] = [],
): string {
  const byRef = new Map<string, WidgetCitationFileEntry>();
  for (const entry of ensureCitationReferences(citations)) {
    const ref = normalizeCitationReference(entry.reference);
    if (ref) byRef.set(ref, entry);
  }

  return String(html).replace(/\[(\d+)\]/g, (match, n: string) => {
    const citation = byRef.get(String(n));
    if (!citation) return match;
    if (!citation.url && !citation.fileName) return match;
    return buildCitationBadgeHtml(citation, sources) || match;
  });
}

function normalizeCitationFiles(data: Record<string, unknown>): WidgetCitationFileEntry[] {
  const files = Array.isArray(data.files) ? (data.files as WidgetCitationFileEntry[]) : [];

  if (files.length > 0) {
    return ensureCitationReferences(files);
  }

  const file = typeof data.fileName === 'string' ? data.fileName : '';
  const source = typeof data.source === 'string' ? data.source : '';
  const path = typeof data.path === 'string' ? data.path : '';
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : '';
  const reference = normalizeCitationReference(
    typeof data.reference === 'string' ? data.reference : '',
  );
  const page = typeof data.page === 'string' ? data.page : '';
  const highlightText = extractHighlightText(
    (typeof data.highlightText === 'string' && data.highlightText) ||
      (typeof data.pageContent === 'string' && data.pageContent) ||
      '',
  );
  const url = source || path;
  const fileName = file || url.split('/').pop() || '';
  if (!fileName && !url && !reference) return [];

  return ensureCitationReferences([
    {
      fileName: fileName || url,
      url,
      workspaceId,
      reference,
      page,
      pageNum: parseCitationPage(page),
      highlightText,
    },
  ]);
}

/**
 * Renders numbered citation badges for every citation in the reply.
 * Always emits 1..N badges so numbers remain clickable even when inline
 * markers are missing or failed to inject.
 */
export function renderCitation(data: Record<string, unknown>): string {
  const normalizedFiles = sortCitationsByReference(normalizeCitationFiles(data));
  const sources = Array.isArray(data.sources) ? (data.sources as WidgetSourceItem[]) : [];
  if (!normalizedFiles.length) return '';

  const itemsHtml = normalizedFiles
    .map((entry) => buildCitationBadgeHtml(entry, sources))
    .filter(Boolean)
    .join('');

  if (!itemsHtml) return '';
  return '<div class="ys-comp-wrap ys-comp-citations">' + itemsHtml + '</div>';
}

/** Renders a validated, non-interactive reference representation of a choice component. */
export function renderChoice(data: Record<string, unknown>, renderId = 'choice'): string {
  if (data.schemaVersion !== 1 || !Array.isArray(data.options) || data.options.length < 2) return '';
  const presentation = data.presentation === 'list' ? 'ys-choice-list' : 'ys-choice-quick';
  const options = data.options
    .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object')
    .map((option) => {
      const id = typeof option.id === 'string' ? option.id : '';
      const label = typeof option.label === 'string' ? option.label : '';
      if (!id || !label) return '';
      return `<button type="button" class="ys-choice-option" data-ys-choice-component="${escapeAttr(renderId)}" data-ys-choice-option="${escapeAttr(id)}"${option.disabled === true ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
    })
    .join('');
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  return options ? `<section class="ys-comp-wrap ys-choice ${presentation}"><p class="ys-choice-prompt">${escapeHtml(prompt)}</p><div class="ys-choice-options">${options}</div></section>` : '';
}

export const RENDERER_MAP: Record<string, (data: Record<string, unknown>, renderId?: string) => string> = {
  text: renderText,
  sources: renderSources,
  citation: renderCitation,
  choice: renderChoice,
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeHttpUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '#';
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sourcesLabel(count: number): string {
  const fr = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase().startsWith('fr');
  if (fr) {
    return count === 1 ? '1 source utilisée' : `${count} sources utilisées`;
  }
  return count === 1 ? 'Used 1 source' : `Used ${count} sources`;
}

function sourceDisplayLabel(title: string, url: string): string {
  const trimmed = title.trim();
  return trimmed || extractDomain(url);
}

function globeIconSvg(): string {
  return '<svg class="ys-globe-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
}

function bookIconSvg(): string {
  return '<svg class="ys-book-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>';
}

function chevronIconSvg(): string {
  return '<svg class="ys-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
}
