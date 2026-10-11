import type { Agent } from '@/modules/agent/types';
import type { CitationData, MessageContentPart } from '@/components/ai-elements/ai-message-content';

export type AnswerRenderMode = 'markdown' | 'openui';

/**
 * Phase-1 spike signal: an agent whose slug starts with this prefix answers in
 * OpenUI Lang. `slug` is already on every agent the front receives, so no
 * backend contract changes; absent or any other slug keeps markdown.
 */
export const OPENUI_AGENT_SLUG_PREFIX = 'openui-';

/** Build-time kill switch; the OpenUI chunk is never requested while it is off. */
export function isOpenUiRenderEnabled(): boolean {
  return import.meta.env.VITE_OPENUI_RENDER_ENABLED === 'true';
}

export function resolveAnswerRenderMode(agent: Pick<Agent, 'slug'> | undefined | null): AnswerRenderMode {
  if (!isOpenUiRenderEnabled()) return 'markdown';
  return agent?.slug?.startsWith(OPENUI_AGENT_SLUG_PREFIX) ? 'openui' : 'markdown';
}

export type AnswerSegment =
  | { kind: 'parts'; parts: MessageContentPart[] }
  | { kind: 'openui'; content: string; isLast: boolean; citations?: CitationData[]; componentId?: string };

/**
 * Splits projected answer parts so text parts render as OpenUI programs and
 * every other part (choices, sources, artifacts…) keeps its regular renderer.
 * Each text part is a self-contained program: a tool call between two texts
 * starts a new `root = …` document.
 */
export function segmentAnswerParts(parts: readonly MessageContentPart[]): AnswerSegment[] {
  const lastTextIndex = parts.map((part) => part.type).lastIndexOf('text');
  const segments: AnswerSegment[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      segments.push({ kind: 'openui', content: part.content, isLast: index === lastTextIndex, citations: part.citations, componentId: part.componentId });
      return;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'parts') previous.parts.push(part);
    else segments.push({ kind: 'parts', parts: [part] });
  });
  return segments;
}
