import type { Agent } from '@/modules/agent/types';
import type { CitationData, MessageContentPart } from '@/components/ai-elements/ai-message-content';

export type AnswerRenderMode = 'markdown' | 'openui';

/** Build-time kill switch; the OpenUI chunk is never requested while it is off. */
export function isOpenUiRenderEnabled(): boolean {
  return import.meta.env.VITE_OPENUI_RENDER_ENABLED === 'true';
}

/**
 * An agent answers in OpenUI Lang when its generative UI toggle is on (agent edit form) and the build
 * has the kill switch on. `genUiEnabled` is part of every `Agent` the front receives, so no extra
 * lookup per message. Absent or off keeps markdown.
 */
export function resolveAnswerRenderMode(agent: Pick<Agent, 'genUiEnabled'> | undefined | null): AnswerRenderMode {
  if (!isOpenUiRenderEnabled()) return 'markdown';
  return agent?.genUiEnabled === true ? 'openui' : 'markdown';
}

export type AnswerSegment =
  | { kind: 'parts'; parts: MessageContentPart[] }
  | { kind: 'openui'; content: string; isLast: boolean; citations?: CitationData[]; componentId?: string };

/** The start of a stored OpenUI program: a chat card or a report root on the first line. */
const OPENUI_PROGRAM_START = /^\s*root\s*=\s*(?:Card|Report)\s*\(/;

/**
 * Answers keep the form they were produced in: a stored text that is an OpenUI program still renders
 * as one after its agent's toggle is switched off (the renderer falls back to markdown the other way
 * round, for a markdown answer of an agent switched on later).
 */
export function looksLikeOpenUiProgram(content: string): boolean {
  return OPENUI_PROGRAM_START.test(content);
}

/**
 * Splits projected answer parts so text parts render as OpenUI programs and
 * every other part (choices, sources, artifacts…) keeps its regular renderer.
 * Each text part is a self-contained program: a tool call between two texts
 * starts a new `root = …` document. In `markdown` mode only the text parts that
 * are already OpenUI programs are taken.
 */
export function segmentAnswerParts(parts: readonly MessageContentPart[], mode: AnswerRenderMode): AnswerSegment[] {
  const asProgram = (part: MessageContentPart) => part.type === 'text' && (mode === 'openui' || looksLikeOpenUiProgram(part.content));
  const lastTextIndex = parts.map((part) => part.type).lastIndexOf('text');
  const segments: AnswerSegment[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'text' && asProgram(part)) {
      segments.push({ kind: 'openui', content: part.content, isLast: index === lastTextIndex, citations: part.citations, componentId: part.componentId });
      return;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'parts') previous.parts.push(part);
    else segments.push({ kind: 'parts', parts: [part] });
  });
  return segments;
}
