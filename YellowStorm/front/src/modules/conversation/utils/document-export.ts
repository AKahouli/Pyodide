import type { Message } from '../types';
import { componentsToMarkdown } from '../utils';

/** One conversational turn in an exported document. */
export interface ExportBlock {
  role: 'user' | 'ai';
  label: string;
  timestamp?: string;
  markdown: string;
}

const EXPORT_PAGE_LIMIT = 100;
const EXPORT_MAX_PAGES = 100;

function sanitizeFilename(title: string): string {
  const cleaned = title.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').slice(0, 80);
  return cleaned || 'conversation';
}

export function buildExportFilename(title: string, extension: 'docx' | 'pdf' | 'html'): string {
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
    const markdown = componentsToMarkdown(message.components || []);
    if (!markdown.trim()) return;
    const turn: SortedTurn = { time: timeOf(message.createdAt), seq: index, block: { role: 'ai', label: labels.assistant, timestamp: stamp(message.createdAt), markdown } };
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
