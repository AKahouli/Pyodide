import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DocxRenderer } from './index';

const closeTabMock = vi.hoisted(() => vi.fn());

vi.mock('../../store', () => ({
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ closeTab: closeTabMock, refreshTabUrl: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

describe('DocxRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when not active', () => {
    const { container } = render(
      <DocxRenderer
        tab={{ id: 'doc1', fileName: 'test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://example.test/doc.docx' }}
        isActive={false}
      />,
    );

    expect(container?.firstChild).toBeNull();
  });

  it('renders content when active', () => {
    render(
      <DocxRenderer
        tab={{ id: 'doc1', fileName: 'test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://example.test/doc.docx' }}
        isActive
      />,
    );

    // Verify the download button is rendered
    const downloadButton = screen.getByRole('button');
    expect(downloadButton).toBeInTheDocument();
  });

  it('renders DocViewer component when active', () => {
    const { container } = render(
      <DocxRenderer
        tab={{ id: 'doc1', fileName: 'test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://example.test/doc.docx' }}
        isActive
      />,
    );

    // Check that some content is rendered in the document area
    const documentArea = container?.querySelector('.overflow-auto');
    expect(documentArea).toBeInTheDocument();
  });

  it('renders download button', () => {
    render(
      <DocxRenderer
        tab={{ id: 'doc1', fileName: 'test.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: 'https://example.test/doc.docx' }}
        isActive
      />,
    );

    const downloadButton = screen.getByRole('button');
    expect(downloadButton).toBeInTheDocument();
  });
});
