import { describe, expect, it, vi } from 'vitest';
import { parseInlineMarkdown, parseMarkdownBlocks } from './docx-export';
import { buildExportBlocks, buildExportFilename, fetchAllMessagesForExport } from './document-export';
import type { Message } from '../types';

describe('parseMarkdownBlocks', () => {
  it('parses headings, bullets, numbered lists, quotes, and paragraphs', () => {
    const blocks = parseMarkdownBlocks(['# Title', '', 'Intro line', '- item one', '1. first', '> quoted', 'Bye'].join('\n'));
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'bullet', 'numbered', 'quote', 'paragraph']);
  });

  it('parses GFM tables into header + body rows with inline runs', () => {
    const blocks = parseMarkdownBlocks('| Fixing | Rate |\n| --- | :---: |\n| **EUR3M** | `1.2` |\n| -15D | 0.5 |');
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.kind).toBe('table');
    expect(table.kind === 'table' && table.header.map((runs) => runs[0].text)).toEqual(['Fixing', 'Rate']);
    expect(table.kind === 'table' && table.rows[0][0]).toEqual([{ text: 'EUR3M', bold: true }]);
    expect(table.kind === 'table' && table.rows[0][1]).toEqual([{ text: '1.2', code: true }]);
    expect(table.kind === 'table' && table.rows[1].map((runs) => runs[0].text)).toEqual(['-15D', '0.5']);
  });

  it('accepts single-dash delimiters and keeps escaped pipes inside cells', () => {
    const blocks = parseMarkdownBlocks('| a | b |\n| - | - |\n| x \\| y | z |');
    const table = blocks[0];
    expect(table.kind).toBe('table');
    expect(table.kind === 'table' && table.rows[0].map((runs) => runs[0].text)).toEqual(['x | y', 'z']);
  });

  it('keeps pipe-only text as a paragraph when no delimiter row follows', () => {
    const blocks = parseMarkdownBlocks('a | b');
    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'a | b' }] }]);
  });

  it('captures fenced code blocks verbatim', () => {
    const blocks = parseMarkdownBlocks('```python\nprint(1)\nprint(2)\n```');
    expect(blocks).toEqual([{ kind: 'code', text: 'print(1)\nprint(2)' }]);
  });

  it('parses inline bold, italic, and code runs', () => {
    const runs = parseInlineMarkdown('plain **bold** *ital* `code` tail');
    expect(runs).toEqual([
      { text: 'plain ' },
      { text: 'bold', bold: true },
      { text: ' ' },
      { text: 'ital', italics: true },
      { text: ' ' },
      { text: 'code', code: true },
      { text: ' tail' },
    ]);
  });
});

describe('fetchAllMessagesForExport', () => {
  it('follows cursor pagination until exhausted', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: '1' }], hasMore: true, nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [{ id: '2' }], hasMore: false, nextCursor: null });
    const result = await fetchAllMessagesForExport('conv-1', fetchPage as never);
    expect(result.map((m) => (m as { id: string }).id)).toEqual(['1', '2']);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 'conv-1', { mode: 'cursor', limit: 100, cursor: undefined });
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'conv-1', { mode: 'cursor', limit: 100, cursor: 'cursor-2' });
  });

  it('re-sorts pages into chronological order (backend pages newest-first)', async () => {
    // Page 1 = newest 100 (returned ascending), page 2 = older 100 (ascending).
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        items: [msg('m-151', '2026-01-01T15:01:00Z'), msg('m-152', '2026-01-01T15:02:00Z')],
        hasMore: true,
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        items: [msg('m-1', '2026-01-01T10:00:00Z'), msg('m-2', '2026-01-01T10:01:00Z')],
        hasMore: false,
        nextCursor: null,
      });
    const result = await fetchAllMessagesForExport('conv-1', fetchPage as never);
    expect(result.map((m) => (m as { id: string }).id)).toEqual(['m-1', 'm-2', 'm-151', 'm-152']);
  });

  function msg(id: string, createdAt: string): Message {
    return { id, conversationId: 'conv-1', conversationType: 'ai', content: id, createdAt } as Message;
  }
});

describe('buildExportBlocks', () => {
  it('maps user prompts and answer components into labeled blocks, skipping empties', () => {
    const messages = [
      { conversationType: 'user', content: '  Question?  ', createdAt: '2026-01-01T10:00:00Z' },
      { conversationType: 'ai', components: [{ type: 'text', data: { content: 'Answer' } }], createdAt: '2026-01-01T10:00:05Z' },
      { conversationType: 'user', content: '   ', createdAt: '2026-01-01T10:01:00Z' },
    ] as unknown as Message[];
    const blocks = buildExportBlocks(messages, { user: 'User', assistant: 'Assistant' });
    expect(blocks).toEqual([
      { role: 'user', label: 'User', timestamp: '2026-01-01T10:00:00Z', markdown: 'Question?' },
      { role: 'ai', label: 'Assistant', timestamp: '2026-01-01T10:00:05Z', markdown: 'Answer', components: [{ type: 'text', data: { content: 'Answer' } }] },
    ]);
  });

  it('keeps chart-only answers that have no markdown', () => {
    const messages = [
      { conversationType: 'ai', components: [{ id: 'c', type: 'chart', data: { kind: 'bar', data: [{ x: 1 }], series: [], config: {}, xAxisKey: 'x' } }], createdAt: '2026-01-01T10:00:05Z' },
    ] as unknown as Message[];
    const blocks = buildExportBlocks(messages, { user: 'User', assistant: 'Assistant' });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].markdown).toBe('');
    expect(blocks[0].components).toHaveLength(1);
  });

  it('exports each answer AFTER its question even when the answer timestamp is earlier', () => {
    // QA-observed defect: persisted answers can carry createdAt <= their
    // prompt's; raw timestamp ordering emitted Assistant before User.
    const messages = [
      { id: 'u1', conversationType: 'user', content: 'Q1', createdAt: '2026-01-01T10:00:00Z' },
      { id: 'a1', conversationType: 'ai', questionMessageId: 'u1', components: [{ type: 'text', data: { content: 'A1' } }], createdAt: '2026-01-01T09:59:59Z' },
      { id: 'u2', conversationType: 'user', content: 'Q2', createdAt: '2026-01-01T10:01:00Z' },
      { id: 'a2', conversationType: 'ai', questionMessageId: 'u2', components: [{ type: 'text', data: { content: 'A2' } }], createdAt: '2026-01-01T10:01:00Z' },
    ] as unknown as Message[];
    const blocks = buildExportBlocks(messages, { user: 'User', assistant: 'Assistant' });
    expect(blocks.map((b) => b.markdown)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
  });

  it('collapses regenerated branches to the newest answer per question', () => {
    const messages = [
      { id: 'u1', conversationType: 'user', content: 'Q1', createdAt: '2026-01-01T10:00:00Z' },
      { id: 'a1a', conversationType: 'ai', questionMessageId: 'u1', components: [{ type: 'text', data: { content: 'A1 old' } }], createdAt: '2026-01-01T10:00:05Z' },
      { id: 'a1b', conversationType: 'ai', questionMessageId: 'u1', components: [{ type: 'text', data: { content: 'A1 new' } }], createdAt: '2026-01-01T10:00:10Z' },
    ] as unknown as Message[];
    const blocks = buildExportBlocks(messages, { user: 'User', assistant: 'Assistant' });
    expect(blocks.map((b) => b.markdown)).toEqual(['Q1', 'A1 new']);
  });

  it('interleaves unpaired AI messages by time around the turns', () => {
    const messages = [
      { id: 'a0', conversationType: 'ai', components: [{ type: 'text', data: { content: 'Welcome' } }], createdAt: '2026-01-01T09:00:00Z' },
      { id: 'u1', conversationType: 'user', content: 'Q1', createdAt: '2026-01-01T10:00:00Z' },
      { id: 'a9', conversationType: 'ai', components: [{ type: 'text', data: { content: 'Late news' } }], createdAt: '2026-01-01T11:00:00Z' },
    ] as unknown as Message[];
    const blocks = buildExportBlocks(messages, { user: 'User', assistant: 'Assistant' });
    expect(blocks.map((b) => b.markdown)).toEqual(['Welcome', 'Q1', 'Late news']);
  });
});

describe('buildExportFilename', () => {
  it('sanitizes the title and appends date + extension', () => {
    expect(buildExportFilename('My: Report/2026?', 'docx')).toMatch(/^My-Report2026-\d{4}-\d{2}-\d{2}\.docx$/);
    expect(buildExportFilename('   ', 'pdf')).toMatch(/^conversation-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
