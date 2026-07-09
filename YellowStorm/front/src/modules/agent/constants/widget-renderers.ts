/**
 * TypeScript reference renderers for the public embed widget SSE contract.
 * Mirror of `_ysRenderers` in `widget-template.ts` (vanilla JS runtime).
 * Supported component types: `text`, `sources`, `citation`.
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

  const itemsHtml = sources.map((src: { title?: string; url?: string }) => {
    const title = typeof src.title === 'string' ? src.title : '';
    const url = typeof src.url === 'string' ? src.url : '#';
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
  }).join('');

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

/** Renders document file links at the end of assistant messages. */
export function renderCitation(data: Record<string, unknown>): string {
  const files = Array.isArray(data.files)
    ? (data.files as Array<{ fileName?: string; url?: string }>)
    : [];

  const normalizedFiles =
    files.length > 0
      ? files
      : (() => {
          const file = typeof data.fileName === 'string' ? data.fileName : '';
          const source = typeof data.source === 'string' ? data.source : '';
          const path = typeof data.path === 'string' ? data.path : '';
          const url = source || path;
          const fileName = file || url.split('/').pop() || '';
          return fileName || url ? [{ fileName: fileName || url, url }] : [];
        })();

  if (!normalizedFiles.length) return '';

  const itemsHtml = normalizedFiles
    .map((entry) => {
      const fileName = typeof entry.fileName === 'string' ? entry.fileName : '';
      const url = typeof entry.url === 'string' ? entry.url : '';
      const label = fileName || url || 'Source';
      const href = buildCitationFileHref(url, url);
      return (
        '<a class="ys-comp-citation-link" href="' +
        escapeAttr(href) +
        '" target="_blank" rel="noopener noreferrer" title="' +
        escapeAttr(label) +
        '">' +
        bookIconSvg() +
        '<span>' +
        escapeHtml(label) +
        '</span></a>'
      );
    })
    .join('');

  return '<div class="ys-comp-wrap ys-comp-citations">' + itemsHtml + '</div>';
}

export const RENDERER_MAP: Record<string, (data: Record<string, unknown>, renderId?: string) => string> = {
  text: renderText,
  sources: renderSources,
  citation: renderCitation,
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const label = trimmed || extractDomain(url);
  if (label.length <= 72) {
    return label;
  }
  return `${label.slice(0, 69)}...`;
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
