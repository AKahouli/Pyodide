import { describe, expect, it } from 'vitest';
import { componentsToMarkdown, formatTimingMs, getStreamErrorMessage, mapComponentsToContentParts } from './utils';

describe('conversation utils', () => {
  it('formats timing values', () => {
    expect(formatTimingMs(undefined)).toBe('--');
    expect(formatTimingMs(550)).toBe('550ms');
    expect(formatTimingMs(1500)).toBe('1.5s');
  });

  it('maps components and attaches citation to parent text', () => {
    const parts = mapComponentsToContentParts([
      { id: 'p1', type: 'text', data: { content: 'Hello' } } as never,
      { type: 'citation', data: { parentId: 'p1', source: 'doc.pdf', page: '2' } } as never,
    ]);

    expect(parts[0]?.type).toBe('text');
    if (parts[0]?.type === 'text') {
      expect(parts[0].citations?.[0]?.source).toBe('doc.pdf');
    }
  });

  it('converts components to markdown', () => {
    const markdown = componentsToMarkdown([
      { type: 'text', data: { content: 'Hi' } },
      { type: 'code', data: { language: 'ts', content: 'const a = 1;' } },
    ] as never);

    expect(markdown).toContain('Hi');
    expect(markdown).toContain('```ts');
  });

  it('maps snake_case sandbox and artifact component fields', () => {
    const parts = mapComponentsToContentParts([
      {
        type: 'sandbox',
        data: { code: 'print(1)', output: 'done', error: '', output_available: true },
      } as never,
      {
        type: 'artifact',
        data: { file_path: 'user/execution/ai_summary.docx', filename: 'ai_summary.docx' },
      } as never,
    ]);

    expect(parts[0]).toMatchObject({
      type: 'sandbox',
      outputAvailable: true,
    });
    expect(parts[1]).toMatchObject({
      type: 'artifact',
      filePath: 'user/execution/ai_summary.docx',
      filename: 'ai_summary.docx',
    });
  });

  it('returns stream error metadata for known and unknown codes', () => {
    const critical = getStreamErrorMessage('ERR_1417');
    const fallback = getStreamErrorMessage('UNKNOWN');

    expect(critical.isCritical).toBe(true);
    expect(fallback.isCritical).toBe(false);
  });
});
