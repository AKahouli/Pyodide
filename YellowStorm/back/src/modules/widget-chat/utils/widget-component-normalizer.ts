import { ComponentType } from '@modules/conversation/interfaces/message.interface';

/** Component types emitted on the public widget SSE stream (gRPC: TextComponent | SourcesComponent). */
export type WidgetStreamComponentType = 'text' | 'sources';

/** Mirrors chatbot.proto SourceItem / SourcesComponent for the widget SSE stream. */
export interface WidgetSourceItem {
  title: string;
  url: string;
}

export interface WidgetSourcesData {
  sources: WidgetSourceItem[];
}

/** Fixed SSE slot id for consolidated assistant text in the widget stream. */
export const WIDGET_PRIMARY_TEXT_ID = 'widget-primary-text';

/**
 * Returns true only for non-empty `text` and `sources` payloads in the widget SSE contract.
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

/**
 * Normalizes gRPC components before the widget SSE stream.
 * Only `sources` needs shaping; all other types pass through and are filtered by `shouldEmitWidgetComponent`.
 */
export function normalizeWidgetComponent(
  type: ComponentType,
  data: Record<string, unknown>,
): { type: ComponentType; data: Record<string, unknown> } {
  if (type === 'sources') {
    return { type: 'sources', data: { ...normalizeWidgetSourcesData(data) } };
  }

  return { type, data };
}
