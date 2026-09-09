import type { MarkdownHeadingInfo } from '@/components/ai-elements/ai-message-content';
import { getUserMessageDisplayText } from '../../utils';
import type { Message } from '../../types';

/** Heading levels listed in the rail; deeper levels keep anchor ids only. */
export const OUTLINE_LISTED_LEVELS: ReadonlySet<number> = new Set([1, 2, 3]);

/** One question/answer block in the outline rail. */
export interface OutlineGroup {
  key: string;
  /** User message id backing the group header; null for a leading answer block. */
  questionId: string | null;
  questionText: string | null;
  items: MarkdownHeadingInfo[];
}

/**
 * Groups outline headings under the user prompt that produced them, in
 * conversation order. Answers arriving before any usable question are kept as
 * an unlabeled leading block; the in-flight streaming answer (whose id is not
 * yet in `messages`) is appended to the current block, guarded so a restored
 * or completed stream id already present in `messages` cannot double-register.
 */
export function buildOutlineGroups(messages: Message[], headingsByMessageId: Record<string, MarkdownHeadingInfo[]>, streamingMessageId: string | null, isStreaming = false): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  let current: OutlineGroup | null = null;
  const ensureGroup = () => {
    if (!current) {
      current = { key: 'leading', questionId: null, questionText: null, items: [] };
      groups.push(current);
    }
    return current;
  };

  const visitedMessageIds = new Set<string>();
  const seenHeadingIds = new Set<string>();
  const pushHeadings = (headings: MarkdownHeadingInfo[] | undefined) => {
    if (!headings) return;
    for (const heading of headings) {
      // Anchor ids are DOM-unique; collapsing repeats guards against any stale
      // double registration resurfacing in the rail.
      if (seenHeadingIds.has(heading.id)) continue;
      seenHeadingIds.add(heading.id);
      ensureGroup().items.push(heading);
    }
  };
  for (const message of messages) {
    if (message.conversationType === 'user') {
      const text = getUserMessageDisplayText(message).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      current = { key: `q-${message.id}`, questionId: message.id, questionText: text, items: [] };
      groups.push(current);
      continue;
    }
    visitedMessageIds.add(message.id);
    pushHeadings(headingsByMessageId[message.id]);
  }
  if (isStreaming && streamingMessageId && !visitedMessageIds.has(streamingMessageId)) {
    pushHeadings(headingsByMessageId[streamingMessageId]);
  }

  return groups.filter((group) => group.questionId !== null || group.items.length > 0);
}
