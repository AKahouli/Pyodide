import { describe, expect, it, vi, beforeEach } from 'vitest';

import { openCitationSource, type CitationData } from './ai-message-content';
import { openFileViewerFromUrlLoader } from '@/modules/file-viewer';

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn().mockResolvedValue(undefined),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));

function makeCitation(overrides: Partial<CitationData>): CitationData {
  return {
    parentId: '',
    sourceType: 'text',
    source: '',
    externalId: '',
    page: '',
    pageContent: '',
    workspaceId: '',
    ...overrides,
  };
}

describe('openCitationSource', () => {
  beforeEach(() => {
    vi.mocked(openFileViewerFromUrlLoader).mockClear();
  });

  it('opens web citations directly in a new tab without calling the citations API', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await openCitationSource(
      makeCitation({ source: 'https://example.com/article' }),
      'sidebar',
      'Source',
      { conversationId: 'conv-1', messageId: 'msg-1' },
    );

    expect(openSpy).toHaveBeenCalledWith('https://example.com/article', '_blank', 'noopener,noreferrer');
    expect(openFileViewerFromUrlLoader).not.toHaveBeenCalled();
  });

  it('opens first-class web citations with a text fragment', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    await openCitationSource(makeCitation({
      sourceType: 'web', sourceKind: 'web', source: 'https://example.com/article?q=1',
      exactText: 'Revenue increased by 38%', prefix: 'Results', suffix: 'Outlook',
    }), 'sidebar', 'Source');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/article?q=1#:~:text=Results-,Revenue%20increased%20by%2038%25,-Outlook',
      '_blank', 'noopener,noreferrer',
    );
  });

  it('does not open an invalid first-class web citation URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await openCitationSource(makeCitation({
      sourceType: 'web', sourceKind: 'web', source: 'https://[', exactText: 'Evidence',
    }), 'sidebar', 'Source');

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('loads workspace document citations through the file viewer', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await openCitationSource(
      makeCitation({ source: 'owner/ws/report.pdf', fileName: 'report.pdf' }),
      'sidebar',
      'Source',
      { conversationId: 'conv-1', messageId: 'msg-1' },
    );

    expect(openSpy).not.toHaveBeenCalled();
    expect(openFileViewerFromUrlLoader).toHaveBeenCalledTimes(1);
  });
});
