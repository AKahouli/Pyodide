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
