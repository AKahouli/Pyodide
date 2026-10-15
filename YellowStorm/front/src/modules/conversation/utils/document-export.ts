import type { Message, MessageComponent } from '../types';
import { componentToMarkdown, componentsToMarkdown, isVisualConversationComponent } from '../utils';
import { createOpenUiTextProjector, exportPartsToMarkdown, isOpenUiProgram, projectOpenUiProgram, type OpenUiExportPart } from '../components/openui/plain-text';

/** One conversational turn in an exported document. */
export interface ExportBlock {
  role: 'user' | 'ai';
  label: string;
  timestamp?: string;
  markdown: string;
  /** Answer components; exports that render visuals (charts, HTML previews) walk these in order. */
  components?: MessageComponent[];
  parts?: OpenUiExportPart[];
}

export type ExportImageResolver = (source: string, component: MessageComponent, message: Message) => Promise<string>;

/** Ephemeral instructions for the existing MCP export flow. Persistent selectors
 * are preserved exactly; the authorized agent resolves them before execution. */
export async function buildMcpExportManifest(message: Message): Promise<{ parts: Array<OpenUiExportPart & { componentId?: string }> }> {
  const parts: Array<OpenUiExportPart & { componentId?: string }> = [];
  if (message.conversationType === 'user') {
    if (message.content?.trim()) parts.push({ kind: 'markdown', markdown: message.content });
    return { parts };
  }
  for (const component of message.components ?? []) {
    if (component.type === 'text' && isOpenUiProgram(component.data?.content)) {
      parts.push(...(await projectOpenUiProgram(String(component.data?.content))).map((part) => ({ ...part, componentId: component.id })));
    } else {
      if (isVisualConversationComponent(component)) throw new Error('Legacy visual MCP export is unsupported');
      const markdown = componentToMarkdown(component);
      if (markdown.trim()) parts.push({ kind: 'markdown', markdown, componentId: component.id });
    }
  }
  return { parts };
}

/** Export only saved content. Resolving assets here makes every format use the
 * same validated image and prevents temporary UI URLs leaking into saved files. */
export async function buildStructuredExportBlocks(
  messages: Message[],
  labels: { user: string; assistant: string },
  formatTimestamp?: (iso: string) => string,
  resolveImage?: ExportImageResolver,
): Promise<ExportBlock[]> {
  // Choose the saved branch before parsing/resolving it. An obsolete answer's
  // deleted image must not prevent exporting the replacement answer.
  const questionIds = new Set(messages.filter((message) => message.conversationType === 'user' && message.content?.trim()).map((message) => message.id));
  const selected = new Map<string, { index: number; time: number }>();
  messages.forEach((message, index) => {
    if (message.conversationType !== 'ai' || !message.questionMessageId || !questionIds.has(message.questionMessageId)) return;
    const components = message.components ?? [];
    if (!components.some((component) => isVisualConversationComponent(component)
      || (component.type === 'text' && isOpenUiProgram(component.data?.content))
      || componentToMarkdown(component).trim())) return;
    const parsedTime = Date.parse(message.createdAt);
    const time = Number.isNaN(parsedTime) ? Number.NEGATIVE_INFINITY : parsedTime;
    const existing = selected.get(message.questionMessageId);
    if (!existing || time >= existing.time) selected.set(message.questionMessageId, { index, time });
  });
  const selectedMessages = messages.filter((message, index) => message.conversationType !== 'ai'
    || !message.questionMessageId || !questionIds.has(message.questionMessageId)
    || selected.get(message.questionMessageId)?.index === index);
  const projected = await Promise.all(selectedMessages.map(async (message) => {
    if (message.conversationType !== 'ai' || !message.components?.some((component) => component.type === 'text' && isOpenUiProgram(component.data?.content))) return { message, parts: undefined };
    const parts: OpenUiExportPart[] = [];
    const components: MessageComponent[] = [];
    for (const component of message.components ?? []) {
      if (component.type === 'text' && isOpenUiProgram(component.data?.content)) {
        const projectedParts = await projectOpenUiProgram(String(component.data?.content));
        for (const part of projectedParts) {
          if (part.kind !== 'image') { parts.push(part); continue; }
          if (!resolveImage) throw new Error('OpenUI export image resolver required');
          const source = await resolveImage(part.source, component, message);
          if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) throw new Error('Invalid resolved OpenUI export image');
          parts.push({ ...part, source });
        }
        components.push({ ...component, data: { ...component.data, content: exportPartsToMarkdown(projectedParts) } });
      } else {
        if (isVisualConversationComponent(component)) throw new Error('Mixed OpenUI and legacy visual export is unsupported');
        const markdown = componentToMarkdown(component);
        if (markdown.trim()) parts.push({ kind: 'markdown', markdown });
        components.push(component);
      }
    }
    return { message: { ...message, components }, parts };
  }));
  const blocks = buildExportBlocks(projected.map((entry) => entry.message), labels, formatTimestamp);
  // Blocks retain the exact component array of their selected answer, including
  // newest-answer branch selection performed by buildExportBlocks.
  for (const block of blocks) {
    const owner = projected.find((entry) => entry.message.components === block.components);
    if (owner?.parts) { block.parts = owner.parts; block.markdown = exportPartsToMarkdown(owner.parts); }
  }
  return blocks;
}

const EXPORT_PAGE_LIMIT = 100;
const EXPORT_MAX_PAGES = 100;

function sanitizeFilename(title: string): string {
  const cleaned = title.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').slice(0, 80);
  return cleaned || 'conversation';
}

export function buildExportFilename(title: string, extension: 'docx' | 'pdf' | 'html' | 'pptx'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(title)}-${date}.${extension}`;
}

/**
 * Fetch every message of a conversation for export. The store only holds the
 * currently loaded window, so export follows cursor pagination server-side
 * (backend caps `limit` at 100) instead of exporting a partial transcript.
 * The cursor API pages newest-first, so pages are collected then re-sorted
 * chronologically (stable for equal timestamps).
 */
export async function fetchAllMessagesForExport(
  conversationId: string,
  fetchPage: (id: string, params: { mode: 'cursor'; limit: number; cursor?: string }) => Promise<{ items: Message[]; hasMore?: boolean; nextCursor?: string | null }>,
): Promise<Message[]> {
  const collected: Message[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
    const result = await fetchPage(conversationId, { mode: 'cursor', limit: EXPORT_PAGE_LIMIT, cursor });
    collected.push(...result.items);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return collected
    .map((message, index) => ({ message, index, time: Date.parse(message.createdAt) }))
    .sort((left, right) => {
      const leftTime = Number.isNaN(left.time) ? Number.NEGATIVE_INFINITY : left.time;
      const rightTime = Number.isNaN(right.time) ? Number.NEGATIVE_INFINITY : right.time;
      return leftTime - rightTime || left.index - right.index;
    })
    .map((entry) => entry.message);
}

interface SortedTurn {
  time: number;
  seq: number;
  block: ExportBlock;
}

/**
 * Turn a list of messages into export blocks. Only turns with visible content
 * are kept: user prompts use their text, answers their markdown rendering.
 * When `formatTimestamp` is given, block timestamps are display-formatted;
 * otherwise the raw ISO string is kept.
 *
 * Each answer is exported immediately after its question (via
 * `questionMessageId`) rather than by raw timestamps — persisted answers can
 * carry a `createdAt` equal to or earlier than their prompt's, which would
 * otherwise render the answer before the prompt in the exported document.
 * Regenerated branches collapse to the newest answer per question.
 */
export function buildExportBlocks(
  messages: Message[],
  labels: { user: string; assistant: string },
  formatTimestamp?: (iso: string) => string,
): ExportBlock[] {
  const stamp = (iso: string) => formatTimestamp?.(iso) ?? iso;
  const timeOf = (iso: string) => {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };

  // Pass 1 — prompts in chronological order.
  const turns: SortedTurn[] = [];
  const turnIds: string[] = [];
  const questionIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.conversationType !== 'user') return;
    const content = message.content?.trim();
    if (!content) return;
    turns.push({ time: timeOf(message.createdAt), seq: index, block: { role: 'user', label: labels.user, timestamp: stamp(message.createdAt), markdown: content } });
    turnIds.push(message.id);
    questionIds.add(message.id);
  });

  // Pass 2 — attach answers to their question; keep the newest per question.
  const answersByQuestion = new Map<string, SortedTurn>();
  const looseAnswers: SortedTurn[] = [];
  messages.forEach((message, index) => {
    if (message.conversationType !== 'ai') return;
    const components = message.components || [];
    const markdown = componentsToMarkdown(components, createOpenUiTextProjector(message.id, components));
    // Chart/HTML-preview-only answers have no markdown but must still be exported.
    if (!markdown.trim() && !components.some(isVisualConversationComponent)) return;
    const turn: SortedTurn = { time: timeOf(message.createdAt), seq: index, block: { role: 'ai', label: labels.assistant, timestamp: stamp(message.createdAt), markdown, components } };
    const questionId = message.questionMessageId;
    if (questionId && questionIds.has(questionId)) {
      const existing = answersByQuestion.get(questionId);
      if (!existing || turn.time >= existing.time) answersByQuestion.set(questionId, turn);
    } else {
      looseAnswers.push(turn);
    }
  });

  // Interleave: prompt → its answer; unpaired answers slot in by time.
  const loose = looseAnswers.sort((left, right) => left.time - right.time || left.seq - right.seq);
  const result: ExportBlock[] = [];
  turns.forEach((turn, index) => {
    while (loose.length && loose[0].time < turn.time) result.push(loose.shift()!.block);
    result.push(turn.block);
    const answer = answersByQuestion.get(turnIds[index]);
    if (answer) result.push(answer.block);
  });
  while (loose.length) result.push(loose.shift()!.block);
  return result;
}
