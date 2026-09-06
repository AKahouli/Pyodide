import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AIMessageContent } from './ai-message-content';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn(),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));

// Count every markdown parse (each MarkdownSegment render = one parse).
const mdCounter = vi.hoisted(() => ({ count: 0 }));
vi.mock('react-markdown', () => ({
  default: ({ children }: { children?: unknown }) => {
    mdCounter.count += 1;
    return <div data-testid='markdown-segment'>{String(children)}</div>;
  },
}));

const base = 'Paragraph one with some prose.\n\n'.repeat(120);

describe('hot-tail memoization (reviewer required probe)', () => {
  it('does not re-parse the stable prefix when only the tail grows, with outline active', () => {
    const onOutlineHeadings = vi.fn();
    const first = render(
      <AIMessageContent parts={[{ type: 'text', content: base + 'Growing tail' }]} onOutlineHeadings={onOutlineHeadings} />,
    );
    const afterFirst = mdCounter.count;
    // stable + tail segments parsed on mount
    expect(afterFirst).toBeGreaterThanOrEqual(2);

    // Same stable prefix, longer tail — the streaming frame case. The stable
    // segment must skip (delta 1); upstream callback identity churn (fresh
    // onOutlineHeadings per render, as the bubble produces) must not matter.
    first.rerender(
      <AIMessageContent parts={[{ type: 'text', content: base + 'Growing tail extended' }]} onOutlineHeadings={vi.fn()} />,
    );
    expect(mdCounter.count - afterFirst).toBe(1);
  });

  it('re-parses both segments only when the stable prefix itself grows', () => {
    mdCounter.count = 0;
    const onOutlineHeadings = vi.fn();
    const first = render(
      <AIMessageContent parts={[{ type: 'text', content: base + 'tail' }]} onOutlineHeadings={onOutlineHeadings} />,
    );
    const afterFirst = mdCounter.count;

    first.rerender(
      <AIMessageContent parts={[{ type: 'text', content: base + 'tail\n\nNew completed paragraph.' }]} onOutlineHeadings={vi.fn()} />,
    );
    // A boundary completed: the stable segment grows and must re-parse once,
    // alongside the new tail.
    expect(mdCounter.count - afterFirst).toBe(2);
  });
});
