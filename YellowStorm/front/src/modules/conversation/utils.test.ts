import { describe, expect, it } from 'vitest';
import { componentsToMarkdown, formatTimingMs, getStreamErrorMessage, mapComponentsToContentParts, normalizeChoiceComponentData } from './utils';

describe('conversation utils', () => {
  it('formats timing values', () => {
    expect(formatTimingMs(undefined)).toBe('--');
    expect(formatTimingMs(550)).toBe('550ms');
    expect(formatTimingMs(1500)).toBe('1.5s');
  });

  it('preserves choice list fields for the interactive renderer', () => {
    const choice = normalizeChoiceComponentData({ schemaVersion: 1, questionId: 'q1', prompt: 'Pick', presentation: 'list', selectionMode: 'multiple', submitBehavior: 'immediate', status: 'ready', labels: { submit: 'Continue' }, progress: { current: 1, total: 2 }, otherOption: { enabled: true, label: 'Other', maxLength: 100 }, options: [{ id: 'a', label: 'A', submitText: 'Choose A' }, { id: 'b', label: 'B', submitText: 'Choose B' }] });
    expect(choice).toMatchObject({ submitBehavior: 'explicit', labels: { submit: 'Continue' }, progress: { current: 1, total: 2 }, otherOption: { enabled: true } });
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

  it('attaches unparented bracketed playbook citations to matching text', () => {
    const parts = mapComponentsToContentParts([
      { type: 'text', data: { content: 'Risque financier majeur [2].' } } as never,
      {
        type: 'citation',
        data: {
          text_source: {
            source: 'user-1/codeinterpreter/contract.docx',
            file_name: 'contract.docx',
            page: '2',
            content: 'Clause de penalites',
            highlight_text: 'Clause de penalites exacte',
            highlight_bbox: [10, 20, 30, 40],
            workspace_name: 'codeinterpreter',
            reference: '[2]',
          },
        },
      } as never,
    ]);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe('text');
    if (parts[0]?.type === 'text') {
      expect(parts[0].citations?.[0]).toMatchObject({
        source: 'user-1/codeinterpreter/contract.docx',
        page: '2',
        pageContent: 'Clause de penalites exacte',
        highlightText: 'Clause de penalites exacte',
        highlightBBox: [10, 20, 30, 40],
        workspaceId: 'codeinterpreter',
        reference: '[2]',
      });
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
