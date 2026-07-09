import { ComponentType } from '@modules/conversation/interfaces/message.interface';

/** Component types emitted on the public widget SSE stream. */
export type WidgetStreamComponentType = 'text' | 'sources' | 'citation';

/** Mirrors chatbot.proto SourceItem / SourcesComponent for the widget SSE stream. */
export interface WidgetSourceItem {
  title: string;
  url: string;
}

export interface WidgetSourcesData {
  sources: WidgetSourceItem[];
}

export type WidgetCitationSourceType = 'text' | 'image';

/** Normalized CitationComponent payload for the widget SSE stream. */
export interface WidgetCitationData {
  parentId: string;
  sourceType: WidgetCitationSourceType;
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

/** Fixed SSE slot id for consolidated assistant text in the widget stream. */
export const WIDGET_PRIMARY_TEXT_ID = 'widget-primary-text';

/** Shown in widget text when the agent performed a web search (query details are stripped). */
export const WIDGET_WEB_SEARCH_MARKER = '🌐 web search :';

/**
 * Removes internal web-search query text from TextComponent content.
 * Keeps only the marker on its line; assistant reply on following lines is preserved.
 */
export function sanitizeWidgetTextContent(content: string): string {
  if (!content.includes(WIDGET_WEB_SEARCH_MARKER)) {
    return content;
  }

  const markerLinePattern = new RegExp(
    `(^|\\n)([ \\t]*)${WIDGET_WEB_SEARCH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n\\r]*`,
    'g',
  );

  return content.replace(markerLinePattern, `$1$2${WIDGET_WEB_SEARCH_MARKER}`);
}

/**
 * Returns true only for non-empty `text`, `sources`, and `citation` payloads.
 */
export function shouldEmitWidgetComponent(
  type: ComponentType,
  data: Record<string, unknown>,
): boolean {
  if (type === 'text') {
    return typeof data.content === 'string' && data.content.trim().length > 0;
  }

  if (type === 'sources') {
    return normalizeWidgetSourcesData(data).sources.length > 0;
  }

  if (type === 'citation') {
    return normalizeWidgetCitationData(data) !== null;
  }

  return false;
}

/**
 * Maps gRPC SourcesComponent wire data to deduplicated `{ sources: SourceItem[] }`.
 */
export function normalizeWidgetSourcesData(data: Record<string, unknown>): WidgetSourcesData {
  const raw = Array.isArray(data.sources) ? data.sources : [];
  const sources: WidgetSourceItem[] = [];
  const seenUrls = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!url) {
      continue;
    }

    const dedupeKey = url.toLowerCase();
    if (seenUrls.has(dedupeKey)) {
      continue;
    }
    seenUrls.add(dedupeKey);

    sources.push({ title, url });
  }

  return { sources };
}

function readStringField(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Maps gRPC CitationComponent (`parent_id` + `text_source` | `image_source`) to widget SSE data.
 * Also accepts the flat shape produced by `extractComponentData` in component-mapper.
 */
export function normalizeWidgetCitationData(data: Record<string, unknown>): WidgetCitationData | null {
  const parentId = readStringField(data, 'parent_id', 'parentId') ?? '';
  const textSource = (data.text_source as Record<string, unknown> | undefined) ?? undefined;
  const imageSource = (data.image_source as Record<string, unknown> | undefined) ?? undefined;
  const sourceData = textSource ?? imageSource;

  if (sourceData) {
    const sourceType: WidgetCitationSourceType = imageSource ? 'image' : 'text';
    return buildWidgetCitationData(parentId, sourceType, sourceData);
  }

  const flatSourceType =
    data.sourceType === 'image' ? 'image' : data.sourceType === 'text' ? 'text' : undefined;
  const inferredType: WidgetCitationSourceType =
    flatSourceType ?? (readStringField(data, 'path') ? 'image' : 'text');

  return buildWidgetCitationData(parentId, inferredType, data);
}

function buildWidgetCitationData(
  parentId: string,
  sourceType: WidgetCitationSourceType,
  sourceData: Record<string, unknown>,
): WidgetCitationData | null {
  const normalized: WidgetCitationData = {
    parentId,
    sourceType,
    type: readStringField(sourceData, 'type'),
    source: readStringField(sourceData, 'source'),
    fileName: readStringField(sourceData, 'file_name', 'fileName'),
    page: readStringField(sourceData, 'page'),
    pageContent: readStringField(sourceData, 'page_content', 'pageContent', 'content'),
    workspaceId: readStringField(sourceData, 'workspace_id', 'workspaceId'),
    workspaceName: readStringField(sourceData, 'workspace_name', 'workspaceName'),
    path: readStringField(sourceData, 'path'),
    reference: readStringField(sourceData, 'reference'),
    highlightText: readStringField(sourceData, 'highlight_text', 'highlightText'),
  };

  if (
    !normalized.reference &&
    !normalized.source &&
    !normalized.fileName &&
    !normalized.path &&
    !normalized.pageContent
  ) {
    return null;
  }

  return normalized;
}

/**
 * Normalizes gRPC components before the widget SSE stream.
 */
export function normalizeWidgetComponent(
  type: ComponentType,
  data: Record<string, unknown>,
): { type: ComponentType; data: Record<string, unknown> } {
  if (type === 'sources') {
    return { type: 'sources', data: { ...normalizeWidgetSourcesData(data) } };
  }

  if (type === 'text' && typeof data.content === 'string') {
    return { type, data: { ...data, content: sanitizeWidgetTextContent(data.content) } };
  }

  if (type === 'citation') {
    const citation = normalizeWidgetCitationData(data);
    return citation ? { type: 'citation', data: { ...citation } } : { type, data };
  }

  return { type, data };
}
