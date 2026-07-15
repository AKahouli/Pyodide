import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CitationBBoxOverlay } from './CitationBBoxOverlay';

vi.mock('@embedpdf/core/react', () => ({
  useDocumentState: () => ({
    document: {
      pages: [
        { size: { width: 600, height: 800 } },
        { size: { width: 600, height: 800 } },
      ],
    },
  }),
}));

describe('CitationBBoxOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps PDF page coordinates to the rendered page', () => {
    render(<CitationBBoxOverlay bbox={[90.1, 169.52, 165.72, 17.09]} documentId='doc-1' page={2} pageIndex={1} />);

    const overlay = screen.getByTestId('citation-bbox-overlay');
    expect(parseFloat(overlay.style.left)).toBeCloseTo(15.02, 2);
    expect(parseFloat(overlay.style.top)).toBeCloseTo(21.19, 2);
    expect(parseFloat(overlay.style.width)).toBeCloseTo(27.62, 2);
    expect(parseFloat(overlay.style.height)).toBeCloseTo(2.14, 2);
  });

  it('does not render on a different page', () => {
    render(<CitationBBoxOverlay bbox={[90.1, 169.52, 165.72, 17.09]} documentId='doc-1' page={2} pageIndex={0} />);

    expect(screen.queryByTestId('citation-bbox-overlay')).not.toBeInTheDocument();
  });

  it('centers the rendered bbox when auto-scroll is enabled', () => {
    const scrollIntoView = vi.fn();
    const requestAnimationFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(1);
      return 1;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);

    render(<CitationBBoxOverlay autoScroll bbox={[90.1, 700, 165.72, 17.09]} documentId='doc-1' page={2} pageIndex={1} />);

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  });
});
