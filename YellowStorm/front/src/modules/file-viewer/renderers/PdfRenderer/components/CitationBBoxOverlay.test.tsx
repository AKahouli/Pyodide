import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
