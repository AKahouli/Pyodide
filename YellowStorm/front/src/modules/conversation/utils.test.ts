import { describe, expect, it } from 'vitest';
import { componentsToMarkdown, formatTimingMs, getConversationStreamActivity, getStreamErrorMessage, getUserMessageDisplayText, mapComponentsToContentParts, mapConversationComponentsToContentParts, formatChoiceSubmissionContent, messageToChat, normalizeChoiceComponentData } from './utils';

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
        fileName: 'contract.docx',
        page: '2',
        pageContent: 'Clause de penalites exacte',
        highlightText: 'Clause de penalites exacte',
        highlightBBox: [10, 20, 30, 40],
        workspaceId: 'codeinterpreter',
        reference: '[2]',
      });
    }
  });

  it('preserves first-class web selectors when attaching citations to text', () => {
    const parts = mapComponentsToContentParts([
      { id: 'text-1', type: 'text', data: { content: 'Python added templates [1].' } } as never,
      { type: 'citation', data: {
        parentId: 'text-1', sourceKind: 'web', sourceType: 'web', source: 'https://example.com/python',
        title: 'Python', exactText: 'Template strings are new.', prefix: 'Python 3.14', suffix: 'Details',
        evidenceOrigin: 'page_content', reference: '1',
      } } as never,
    ]);

    expect(parts[0]).toMatchObject({
      type: 'text', citations: [{
        sourceKind: 'web', sourceType: 'web', exactText: 'Template strings are new.',
        prefix: 'Python 3.14', suffix: 'Details', evidenceOrigin: 'page_content',
      }],
    });
  });

  it('attaches a citation to repeated reference markers outside its original parent', () => {
    const parts = mapComponentsToContentParts([
      { id: 'draft', type: 'text', data: { content: 'Draft result [2].' } } as never,
      { id: 'final', type: 'text', data: { content: 'Final result [2].' } } as never,
      { type: 'citation', data: { parentId: 'draft', source: 'report.pdf', reference: '2' } } as never,
    ]);

    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.type).toBe('text');
      if (part.type === 'text') {
        expect(part.citations).toEqual([expect.objectContaining({ source: 'report.pdf', reference: '2' })]);
      }
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

  it('renders safe activity while excluding it from copied answer markdown', () => {
    const components = [
      { type: 'agentActivity', data: { summary: 'Preparing the answer', status: 'completed' } },
      { type: 'toolActivity', data: { toolName: 'activate_skill', paramsJson: '{"secret":"value"}' } },
      { type: 'text', data: { content: 'Public answer' } },
      { type: 'unknown', data: { content: 'Unexpected payload' } },
    ] as never;

    expect(mapConversationComponentsToContentParts(components)).toEqual([
      expect.objectContaining({ type: 'agentActivity', summary: 'Preparing the answer', status: 'completed' }),
      expect.objectContaining({ type: 'toolActivity', toolName: 'activate_skill' }),
      { type: 'text', content: 'Public answer' },
    ]);
    expect(componentsToMarkdown(components)).toBe('Public answer');
  });

  it('uses generic activity states without exposing tool details', () => {
    expect(getConversationStreamActivity([])).toBe('thinking');
    expect(getConversationStreamActivity([{ type: 'toolActivity', data: { title: 'activate_skill' } }] as never)).toBe('usingTools');
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
        data: { artifactId: 'artifact-1', filename: 'ai_summary.docx', availability: 'ready' },
      } as never,
    ]);

    expect(parts[0]).toMatchObject({
      type: 'sandbox',
      outputAvailable: true,
    });
    expect(parts[1]).toMatchObject({
      type: 'artifact',
      filePath: '',
      filename: 'ai_summary.docx',
    });
  });

  it('returns stream error metadata for known and unknown codes', () => {
    const critical = getStreamErrorMessage('ERR_1417');
    const fallback = getStreamErrorMessage('UNKNOWN');

    expect(critical.isCritical).toBe(true);
    expect(fallback.isCritical).toBe(false);
  });

  it('preserves edit-on-card editable fields', () => {
    const choice = normalizeChoiceComponentData({
      schemaVersion: 1, questionId: 'confirm::x', prompt: 'Approve?', presentation: 'quick_replies',
      selectionMode: 'single', submitBehavior: 'immediate', status: 'ready', editable: true,
      fields: [
        { key: 'subject', label: 'Objet', value: 'Status' },
        { key: 'body', label: 'Message', value: 'Hi', multiline: true },
        { key: 'to_recipients', label: 'À', value: 'a@b.co', type: 'list' },
        { key: 'bad' },
      ],
      options: [{ id: 'approve', label: 'Approuver', submitText: 'approve' }, { id: 'decline', label: 'Refuser', submitText: 'decline' }],
    });
    expect(choice?.editable).toBe(true);
    expect(choice?.fields).toEqual([
      { key: 'subject', label: 'Objet', value: 'Status' },
      { key: 'body', label: 'Message', value: 'Hi', multiline: true },
      { key: 'to_recipients', label: 'À', value: 'a@b.co', type: 'list' },
    ]);
  });

  it('omits editable when no valid fields', () => {
    const choice = normalizeChoiceComponentData({
      schemaVersion: 1, questionId: 'q', prompt: 'Pick', presentation: 'quick_replies',
      selectionMode: 'single', submitBehavior: 'immediate', status: 'ready', editable: true, fields: [],
      options: [{ id: 'a', label: 'A', submitText: 'a' }, { id: 'b', label: 'B', submitText: 'b' }],
    });
    expect(choice?.editable).toBeUndefined();
    expect(choice?.fields).toBeUndefined();
  });
});

describe('formatChoiceSubmissionContent', () => {
  it('renders friendly labels for verdicts and edit payloads', () => {
    expect(formatChoiceSubmissionContent('approve')).toBe('Approuvé');
    expect(formatChoiceSubmissionContent('decline')).toBe('Refusé');
    expect(formatChoiceSubmissionContent('{"verdict":"approve","edits":{"subject":"x"}}')).toBe('Approuvé');
    expect(formatChoiceSubmissionContent('{"verdict":"decline"}')).toBe('Refusé');
    // ordinary content passes through untouched
    expect(formatChoiceSubmissionContent('Bonjour, peux-tu vérifier ?')).toBe('Bonjour, peux-tu vérifier ?');
    expect(formatChoiceSubmissionContent('{not json')).toBe('{not json');
  });
});
