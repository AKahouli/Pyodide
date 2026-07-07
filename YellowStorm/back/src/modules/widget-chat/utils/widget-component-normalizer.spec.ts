import {
  normalizeWidgetComponent,
  normalizeWidgetSourcesData,
  shouldEmitWidgetComponent,
} from './widget-component-normalizer';

describe('widget-component-normalizer', () => {
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

  it('suppresses non-widget components from the public widget stream', () => {
    expect(shouldEmitWidgetComponent('task', { title: 'Task', items: ['step'] })).toBe(false);
    expect(shouldEmitWidgetComponent('plan', { title: 'Plan', steps: [] })).toBe(false);
    expect(shouldEmitWidgetComponent('code', { content: 'print("hello")' })).toBe(false);
    expect(shouldEmitWidgetComponent('sandbox', { code: 'print("hello")' })).toBe(false);
    expect(shouldEmitWidgetComponent('reasoning', { content: 'thinking...' })).toBe(false);
  });
});
