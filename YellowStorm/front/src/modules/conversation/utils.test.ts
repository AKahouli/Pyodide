import { describe, expect, it } from 'vitest';
import { componentsToMarkdown, formatTimingMs, getConversationStreamActivity, getStreamErrorMessage, getUserMessageDisplayText, mapComponentsToContentParts, mapConversationComponentsToContentParts, messageToChat, normalizeChoiceComponentData } from './utils';

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

  it('uses concise canonical display text for submitted choice messages', () => {
    const message = messageToChat({
      id: 'message-1',
      conversationId: 'conversation-1',
      conversationType: 'user',
      content: '{"selectedChoices":[{"submitText":"Analyze profitability"}]}',
      interaction: {
        type: 'choice', componentId: 'choice-1', questionId: 'q1', selectionMode: 'single',
        selectedOptions: [{ optionId: 'profitability', label: 'Profitability' }],
        displayText: 'Profitability',
      },
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    expect(message.content).toBe('Profitability');
  });

  it('joins display texts for multi-interaction user messages instead of raw JSON content', () => {
    const text = getUserMessageDisplayText({
      id: 'message-1',
      conversationId: 'conversation-1',
      conversationType: 'user',
      content: '[{\n  "question": { "prompt": "Pick a region" },\n  "selectedChoices": [ { "optionId": "germany", "submitText": "Use Germany" } ]\n}]',
      interactions: [
        { type: 'choice', componentId: 'choice-1', questionId: 'region', selectionMode: 'single', selectedOptions: [{ optionId: 'germany', label: 'Germany' }], displayText: 'Germany' },
        { type: 'choice', componentId: 'choice-2', questionId: 'scope', selectionMode: 'single', selectedOptions: [{ optionId: 'sales', label: 'Sales' }], displayText: 'Sales' },
      ],
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    expect(text).toBe('Germany, Sales');
  });

  it('falls back to raw content when multi-interaction display texts are missing', () => {
    const text = getUserMessageDisplayText({
      id: 'message-1',
      conversationId: 'conversation-1',
      conversationType: 'user',
      content: 'raw content',
      interactions: [
        { type: 'choice', componentId: 'choice-1', questionId: 'region', selectionMode: 'single', selectedOptions: [{ optionId: 'germany', label: 'Germany' }] },
      ],
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    expect(text).toBe('raw content');
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

  it('excludes internal execution payloads from conversation content and copies', () => {
    const components = [
      { type: 'reasoning', data: { content: 'Internal system instructions' } },
      { type: 'toolInfo', data: { toolName: 'activate_skill', paramsJson: '{"secret":"value"}' } },
      { type: 'text', data: { content: 'Public answer' } },
      { type: 'unknown', data: { content: 'Unexpected payload' } },
    ] as never;

    expect(mapConversationComponentsToContentParts(components)).toEqual([{ type: 'text', content: 'Public answer' }]);
    expect(componentsToMarkdown(components)).toBe('Public answer');
  });

  it('uses generic activity states without exposing tool details', () => {
    expect(getConversationStreamActivity([])).toBe('thinking');
    expect(getConversationStreamActivity([{ type: 'toolInfo', data: { title: 'activate_skill' } }] as never)).toBe('usingTools');
    expect(getConversationStreamActivity([{ type: 'text', data: { content: 'Public answer' } }] as never)).toBe('responding');
  });

  it('maps persisted stream errors from the backend contract', () => {
    expect(mapConversationComponentsToContentParts([
      { type: 'error', data: { code: 'ERR_1406', message: 'AI stream failed unexpectedly.' } },
    ] as never)).toEqual([
      { type: 'error', title: 'ERR_1406', content: 'AI stream failed unexpectedly.' },
    ]);
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
