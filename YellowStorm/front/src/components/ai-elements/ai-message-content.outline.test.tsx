import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AIMessageContent, type MarkdownHeadingInfo } from './ai-message-content';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn(),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));

describe('AIMessageContent outline registration', () => {
  it('assigns stable ids to headings and reports them in document order', async () => {
    const onOutlineHeadings = vi.fn();
    const content = '# Intro\n\nSome text.\n\n## Revenue\n\nNumbers.\n\n### Revenue detail\n\nMore.\n\n#### Deep\n\nDeep.';

    render(<AIMessageContent parts={[{ type: 'text', content }]} onOutlineHeadings={onOutlineHeadings} />);

    const h1 = screen.getByRole('heading', { level: 1 });
    const h2 = screen.getByRole('heading', { level: 2 });
    const h3 = screen.getByRole('heading', { level: 3 });
    const h4 = screen.getByRole('heading', { level: 4 });

    await waitFor(() => expect(onOutlineHeadings).toHaveBeenCalled());
    const headings = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4]);
    expect(headings.map((h) => h.text)).toEqual(['Intro', 'Revenue', 'Revenue detail', 'Deep']);
    expect(headings[0].id).toBe(h1.id);
    expect(headings[1].id).toBe(h2.id);
    expect(headings[2].id).toBe(h3.id);
    expect(headings[3].id).toBe(h4.id);
    expect(h1.id).toMatch(/^outline-/);
    expect(h2.id).not.toBe(h3.id);
  });

  it('re-reports headings when streaming content changes', async () => {
    const onOutlineHeadings = vi.fn();
    const { rerender } = render(<AIMessageContent parts={[{ type: 'text', content: '# First' }]} onOutlineHeadings={onOutlineHeadings} />);
    await waitFor(() => expect(onOutlineHeadings).toHaveBeenCalled());

    rerender(<AIMessageContent parts={[{ type: 'text', content: '# First\n\n## Second' }]} onOutlineHeadings={onOutlineHeadings} />);

    await waitFor(() => {
      const last = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
      expect(last.map((h) => h.text)).toEqual(['First', 'Second']);
    });
  });

  it('strips citation markers from reported heading text while keeping the rendered label', async () => {
    const onOutlineHeadings = vi.fn();
    render(<AIMessageContent parts={[{ type: 'text', content: '##   Multi   space   title  ' }]} onOutlineHeadings={onOutlineHeadings} />);

    await waitFor(() => expect(onOutlineHeadings).toHaveBeenCalled());
    const headings = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
    expect(headings[0].text).toBe('Multi space title');
  });

  it('does not register heading ids when no outline callback is provided', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '# Plain' }]} />);

    expect(screen.getByRole('heading', { level: 1 }).id).toBe('');
  });

  it('keeps native h4 rendering when outline registration is omitted', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '#### Deep section' }]} />);

    const h4 = screen.getByRole('heading', { level: 4 });
    expect(h4.className).not.toContain('text-sm');
    expect(h4.id).toBe('');
  });

  it('applies styled h4 rendering only when outline registration is active', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '#### Deep section' }]} onOutlineHeadings={vi.fn()} />);

    const h4 = screen.getByRole('heading', { level: 4 });
    expect(h4.className).toContain('text-sm font-bold');
    expect(h4.id).toMatch(/^outline-/);
  });

  it('scopes anchor ids by message so two messages never collide', async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <div>
        <AIMessageContent parts={[{ type: 'text', content: '## Shared' }]} citationScope={{ conversationId: 'c1', messageId: 'm1' }} onOutlineHeadings={first} />
        <AIMessageContent parts={[{ type: 'text', content: '## Shared' }]} citationScope={{ conversationId: 'c1', messageId: 'm2' }} onOutlineHeadings={second} />
      </div>,
    );

    await waitFor(() => expect(first).toHaveBeenCalled());
    await waitFor(() => expect(second).toHaveBeenCalled());
    const firstIds = (first.mock.calls.at(-1)![0] as MarkdownHeadingInfo[]).map((h) => h.id);
    const secondIds = (second.mock.calls.at(-1)![0] as MarkdownHeadingInfo[]).map((h) => h.id);
    expect(firstIds[0]).not.toBe(secondIds[0]);
    expect(document.getElementById(firstIds[0])?.textContent).toBe('Shared');
    expect(document.getElementById(secondIds[0])?.textContent).toBe('Shared');
  });

  it('aggregates headings across multiple text parts of one content', async () => {
    const onOutlineHeadings = vi.fn();
    render(
      <AIMessageContent
        parts={[
          { type: 'agentActivity', summary: 'Working', status: 'completed' },
          { type: 'text', content: '# Part One Heading' },
          { type: 'text', content: '## Part Two Heading' },
        ]}
        onOutlineHeadings={onOutlineHeadings}
      />,
    );

    await waitFor(() => {
      const last = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
      expect(last.map((h) => h.text)).toEqual(['Part One Heading', 'Part Two Heading']);
    });
  });

  it('publishes an empty snapshot when headings disappear', async () => {
    const onOutlineHeadings = vi.fn();
    const { rerender } = render(<AIMessageContent parts={[{ type: 'text', content: '# Temporary' }]} onOutlineHeadings={onOutlineHeadings} />);
    await waitFor(() => expect(onOutlineHeadings).toHaveBeenCalled());

    rerender(<AIMessageContent parts={[{ type: 'text', content: 'Just a paragraph now.' }]} onOutlineHeadings={onOutlineHeadings} />);

    await waitFor(() => {
      const last = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
      expect(last).toEqual([]);
    });
  });

  it('reports committed headings exactly once under React StrictMode double-render', async () => {
    const onOutlineHeadings = vi.fn();
    const content = '# Title\n\nIntro.\n\n## Section One\n\n### Section Two\n\nBody.';

    render(
      <StrictMode>
        <AIMessageContent parts={[{ type: 'text', content }]} onOutlineHeadings={onOutlineHeadings} />
      </StrictMode>,
    );

    await waitFor(() => expect(onOutlineHeadings).toHaveBeenCalled());
    const last = onOutlineHeadings.mock.calls.at(-1)![0] as MarkdownHeadingInfo[];
    const ids = last.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...document.querySelectorAll('[id^="outline-"]')].map((el) => el.id));
    expect(last.map((h) => h.text)).toEqual(['Title', 'Section One', 'Section Two']);
  });
});
