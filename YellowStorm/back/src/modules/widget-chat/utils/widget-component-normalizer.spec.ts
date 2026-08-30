import {
  normalizeWidgetCitationData,
  normalizeWidgetComponent,
  normalizeWidgetSourcesData,
  sanitizeWidgetTextContent,
  shouldEmitWidgetComponent,
} from './widget-component-normalizer';

describe('widget-component-normalizer', () => {
  it('emits normalized choice components only when structurally valid', () => {
    const choice = { schemaVersion: 1, questionId: 'q1', prompt: 'Pick', presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate', status: 'ready', options: [{ id: 'a', label: 'A', submitText: 'Choose A' }, { id: 'b', label: 'B', submitText: 'Choose B' }] };
    expect(shouldEmitWidgetComponent('choice', choice)).toBe(true);
    expect(normalizeWidgetComponent('choice', choice).data).toMatchObject({ questionId: 'q1', options: choice.options });
    expect(shouldEmitWidgetComponent('choice', { ...choice, options: [] })).toBe(false);
  });
  it('emits non-empty text components', () => {
    expect(shouldEmitWidgetComponent('text', { content: 'Hello' })).toBe(true);
    expect(shouldEmitWidgetComponent('text', { content: '   ' })).toBe(false);
  });

  it('emits web search sources when the payload is non-empty', () => {
    expect(
      shouldEmitWidgetComponent('sources', {
        sources: [{ title: 'Reuters', url: 'https://www.reuters.com' }],
      }),
    ).toBe(true);
  });

  it('normalizes gRPC SourcesComponent to SourceItem title/url pairs', () => {
    const normalized = normalizeWidgetComponent('sources', {
      sources: [
        { title: 'Reuters', url: 'https://www.reuters.com' },
        { title: '', url: 'https://example.com' },
        { title: 'Duplicate', url: 'https://www.reuters.com' },
        { title: 'No URL', url: '   ' },
      ],
    });

    expect(normalized.type).toBe('sources');
    expect(normalized.data).toEqual({
      sources: [
        { title: 'Reuters', url: 'https://www.reuters.com' },
        { title: '', url: 'https://example.com' },
      ],
    });
  });

  it('maps normalizeWidgetSourcesData from proto-shaped payload', () => {
    expect(
      normalizeWidgetSourcesData({
        sources: [{ title: 'FT Markets', url: 'https://www.ft.com/markets' }],
      }),
    ).toEqual({
      sources: [{ title: 'FT Markets', url: 'https://www.ft.com/markets' }],
    });
  });

  it('passes text components through unchanged', () => {
    const normalized = normalizeWidgetComponent('text', { content: 'Reply body' });
    expect(normalized).toEqual({ type: 'text', data: { content: 'Reply body' } });
  });

  it('strips internal web search query from TextComponent content', () => {
    const raw =
      ' 🌐 web search : inflation en Europe récente cause principale\n\nVoici un article récent sur l’inflation.';
    expect(sanitizeWidgetTextContent(raw)).toBe(
      ' 🌐 web search :\n\nVoici un article récent sur l’inflation.',
    );
  });

  it('normalizes text components with web search marker via normalizeWidgetComponent', () => {
    const normalized = normalizeWidgetComponent('text', {
      content: '🌐 web search : query details only on this line',
    });
    expect(normalized.data.content).toBe('🌐 web search :');
  });

  it('normalizes text citation components from proto-shaped payloads', () => {
    const normalized = normalizeWidgetComponent('citation', {
      parent_id: 'text-parent-1',
      text_source: {
        type: 'text',
        source: 'docs/report.pdf',
        file_name: 'report.pdf',
        page: 'report.pdf - page 5',
        page_content: 'Inflation remains elevated',
        workspace_id: 'ws-123',
        reference: '[1]',
        highlight_text: 'Inflation remains elevated',
      },
    });

    expect(normalized.type).toBe('citation');
    expect(normalized.data).toEqual({
      parentId: 'text-parent-1',
      sourceType: 'text',
      type: 'text',
      source: 'docs/report.pdf',
      fileName: 'report.pdf',
      page: 'report.pdf - page 5',
      pageContent: 'Inflation remains elevated',
      workspaceId: 'ws-123',
      reference: '[1]',
      highlightText: 'Inflation remains elevated',
    });
  });

  it('normalizes image citation components from proto-shaped payloads', () => {
    const normalized = normalizeWidgetComponent('citation', {
      parent_id: 'img-parent-1',
      image_source: {
        type: 'image',
        path: '/storage/chart.png',
        page: '3',
        file_name: 'chart.png',
        workspace_name: 'Finance',
        workspace_id: 'ws-456',
        reference: '[2]',
        highlight_text: 'Chart segment',
      },
    });

    expect(normalized.type).toBe('citation');
    expect(normalized.data).toMatchObject({
      parentId: 'img-parent-1',
      sourceType: 'image',
      path: '/storage/chart.png',
      fileName: 'chart.png',
      workspaceName: 'Finance',
      reference: '[2]',
    });
  });

  it('normalizes flat citation payloads from component-mapper', () => {
    const normalized = normalizeWidgetComponent('citation', {
      parentId: 'text-parent-2',
      sourceType: 'text',
      source: 'docs/report.pdf',
      fileName: 'report.pdf',
      page: '5',
      pageContent: 'Inflation remains elevated',
      workspaceId: 'ws-123',
      reference: '[1]',
      highlightText: 'Inflation remains elevated',
    });

    expect(normalized.type).toBe('citation');
    expect(normalized.data).toMatchObject({
      parentId: 'text-parent-2',
      sourceType: 'text',
      reference: '[1]',
      fileName: 'report.pdf',
    });
  });

  it('suppresses empty citations', () => {
    expect(normalizeWidgetCitationData({})).toBeNull();
    expect(shouldEmitWidgetComponent('citation', {})).toBe(false);
  });

  it('suppresses non-widget components from the public widget stream', () => {
    expect(shouldEmitWidgetComponent('task', { title: 'Task', items: ['step'] })).toBe(false);
    expect(shouldEmitWidgetComponent('plan', { title: 'Plan', steps: [] })).toBe(false);
    expect(shouldEmitWidgetComponent('code', { content: 'print("hello")' })).toBe(false);
    expect(shouldEmitWidgetComponent('sandbox', { code: 'print("hello")' })).toBe(false);
    expect(shouldEmitWidgetComponent('agentActivity', { content: 'thinking...' })).toBe(false);
  });
});
