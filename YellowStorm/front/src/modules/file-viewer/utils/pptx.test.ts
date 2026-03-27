import { describe, expect, it, vi } from 'vitest';
import { clearPptxHighlights, downloadPptxFile, highlightPptxMatches, waitForPptxSlides } from './pptx';

describe('pptx utils', () => {
  it('resolves immediately when slides already exist', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="slide"></div><div class="slide"></div>';

    const slides = await waitForPptxSlides(container, 50);
    expect(slides).toHaveLength(2);
  });

  it('highlights and clears text matches', () => {
    const root = document.createElement('div');
    root.textContent = 'hello world hello';

    const marks = highlightPptxMatches(root, 'hello');
    expect(marks.length).toBe(2);
    expect(root.querySelectorAll('mark').length).toBe(2);

    clearPptxHighlights(root);
    expect(root.querySelectorAll('mark').length).toBe(0);
    expect(root.textContent).toContain('hello world hello');
  });

  it('creates and clicks anchor when downloading file', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadPptxFile('https://example.test/file.pptx', 'slides.pptx');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
