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

describe('AIMessageContent math rendering', () => {
  it('renders `\\[ ... \\]` and `\\( ... \\)` LaTeX through KaTeX', () => {
    const { container } = render(
      <AIMessageContent
        parts={[
          {
            type: 'text',
            content: 'La logique :\n\n\\[\n\\sum_{i=1}^{n} x_i\n\\]\n\navec \\( t_i \\) projeté',
          },
        ]}
      />,
    );

    // One display block plus one inline formula; KaTeX output carries the TeX
    // source in a non-rendered <annotation>, so only delimiters must vanish.
    expect(container.querySelectorAll('.katex-display').length).toBe(1);
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(1);
    expect(container.textContent).not.toContain('\\[');
    expect(container.textContent).not.toContain('\\(');
  });
});
