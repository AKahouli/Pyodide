import { describe, expect, it } from 'vitest';

import { buildOutlineGroups } from './outline-groups';
import type { MarkdownHeadingInfo } from '@/components/ai-elements/ai-message-content';
import type { Message } from '../../types';

function baseMessage(id: string, conversationType: 'user' | 'ai'): Message {
  return { id, conversationId: 'c1', conversationType, createdAt: '2026-01-01T00:00:00Z' };
}

function userMessage(id: string, content: string): Message {
  return { ...baseMessage(id, 'user'), content };
}

function heading(id: string, level: MarkdownHeadingInfo['level'], text: string): MarkdownHeadingInfo {
  return { id, level, text };
}

describe('buildOutlineGroups', () => {
  it('groups answer headings under the preceding user question', () => {
    const messages = [
      userMessage('u1', 'Analyze revenue'),
      baseMessage('a1', 'ai'),
      userMessage('u2', 'Now costs'),
      baseMessage('a2', 'ai'),
    ];
    const headings = {
      a1: [heading('h-a1-1', 2, 'Revenue detail')],
      a2: [heading('h-a2-1', 2, 'Cost detail')],
    };

    const groups = buildOutlineGroups(messages, headings, null);

    expect(groups).toHaveLength(2);
    expect(groups[0].questionId).toBe('u1');
    expect(groups[0].questionText).toBe('Analyze revenue');
    expect(groups[0].items.map((item) => item.id)).toEqual(['h-a1-1']);
    expect(groups[1].questionId).toBe('u2');
    expect(groups[1].items.map((item) => item.id)).toEqual(['h-a2-1']);
  });

  it('keeps a leading answer block without a question', () => {
    const messages = [baseMessage('a1', 'ai')];
    const headings = { a1: [heading('h-1', 1, 'Preamble')] };

    const groups = buildOutlineGroups(messages, headings, null);

    expect(groups).toHaveLength(1);
    expect(groups[0].questionId).toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });

  it('skips user messages without usable text', () => {
    const messages = [userMessage('u1', '   '), baseMessage('a1', 'ai')];
    const headings = { a1: [heading('h-1', 2, 'Section')] };

    const groups = buildOutlineGroups(messages, headings, null);

    expect(groups).toHaveLength(1);
    expect(groups[0].questionId).toBeNull();
  });

  it('appends the in-flight streaming answer to the current group', () => {
    const messages = [userMessage('u1', 'Question'), baseMessage('a1', 'ai')];
    const headings = {
      a1: [heading('h-a1', 2, 'Done part')],
      stream: [heading('h-stream', 2, 'Streaming part')],
    };

    const groups = buildOutlineGroups(messages, headings, 'stream', true);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.text)).toEqual(['Done part', 'Streaming part']);
  });

  it('does not duplicate headings when the stream id is already among the messages', () => {
    const messages = [userMessage('u1', 'Question'), baseMessage('a1', 'ai')];
    const headings = { a1: [heading('h-a1', 2, 'Done part')] };

    const groups = buildOutlineGroups(messages, headings, 'a1', true);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.text)).toEqual(['Done part']);
  });

  it('ignores a restored stream id while not streaming', () => {
    const messages = [userMessage('u1', 'Question'), baseMessage('a1', 'ai')];
    const headings = {
      a1: [heading('h-a1', 2, 'Done part')],
      ghost: [heading('h-ghost', 2, 'Ghost part')],
    };

    const groups = buildOutlineGroups(messages, headings, 'ghost', false);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.text)).toEqual(['Done part']);
  });

  it('collapses repeated heading anchor ids to a single rail entry', () => {
    const messages = [userMessage('u1', 'Question'), baseMessage('a1', 'ai')];
    const headings = {
      a1: [
        heading('outline-0-h2-0', 2, 'Section'),
        heading('outline-0-h2-0', 2, 'Section'),
        heading('outline-0-h3-1', 3, 'Subsection'),
      ],
    };

    const groups = buildOutlineGroups(messages, headings, null);

    expect(groups[0].items.map((item) => item.id)).toEqual(['outline-0-h2-0', 'outline-0-h3-1']);
  });

  it('returns question-only groups and drops completely empty groups', () => {
    const messages = [userMessage('u1', 'Question with no headings yet')];

    const groups = buildOutlineGroups(messages, {}, null);

    expect(groups).toHaveLength(1);
    expect(groups[0].questionId).toBe('u1');
    expect(groups[0].items).toHaveLength(0);
  });
});
