import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AIMessageContent, openCitationSource, type CitationData } from './ai-message-content';
import { MessageProvider } from './message-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openFileViewerFromUrlLoader } from '@/modules/file-viewer';
import { useRecordCitationStore } from '@/modules/semantic-model/citations/record-citation-store';
import { fetchRootEvidence, getCitationViewUrl } from '@/modules/conversation/api';

vi.mock('@/modules/conversation/api', () => ({ fetchRootEvidence: vi.fn(), getCitationViewUrl: vi.fn() }));

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
    vi.clearAllMocks();
  });
  it('keeps unused owned evidence out of the answer while retaining referenced badges', () => {
    render(<AIMessageContent citationScope={{ conversationId: 'conversation', messageId: 'answer' }} parts={[
      { type: 'text', content: 'Verified result [1].', citations: [
        makeCitation({ evidenceId: 'used', executionId: 'worker', reference: '1', source: 'https://example.com/used' }),
        makeCitation({ evidenceId: 'unused', executionId: 'worker', reference: '2', source: 'https://example.com/unused' }),
      ] },
      { type: 'citation', parentId: '', sourceType: 'web', source: 'https://example.com/unreferenced',
        externalId: '', page: '', pageContent: '', workspaceId: '', evidenceId: 'standalone', executionId: 'worker', reference: '3' },
    ]} />);
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3' })).not.toBeInTheDocument();
  });

  it('notifies the conversation before opening an inline citation', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const onCitationOpen = vi.fn();
    render(
      <MessageProvider onCitationOpen={onCitationOpen}>
        <AIMessageContent
          citationScope={{ conversationId: 'conversation', messageId: 'answer' }}
          parts={[{ type: 'text', content: 'Verified [1].', citations: [makeCitation({ source: 'https://example.com/used', reference: '1' })] }]}
        />
      </MessageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(onCitationOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.com/used', '_blank', 'noopener,noreferrer'));
  });

  it('resolves owned evidence before web routing and uses its registered page and scoped cache key', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(fetchRootEvidence).mockResolvedValue({
      evidenceId: 'evidence', kind: 'citation', producerAgentId: 'worker',
      url: 'https://storage.test/read', fileName: 'report.pdf', page: 13
    });
    await openCitationSource(makeCitation({ evidenceId: 'evidence', executionId: 'worker', source: 'https://ignored.test', page: '1' }),
      'sidebar', 'Source', { conversationId: 'conversation', messageId: 'message' });
    expect(fetchRootEvidence).toHaveBeenCalledWith('conversation', 'worker', 'evidence');
    expect(openSpy).not.toHaveBeenCalled();
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    const call = vi.mocked(openFileViewerFromUrlLoader).mock.calls[0];
    expect(call[0]).toBe(JSON.stringify(['conversation', 'worker', 'evidence']));
    expect(call[4]).toMatchObject({ page: 13 });
    expect(await call[3]()).toMatchObject({ page: 13 });
    await call[3]();
    expect(fetchRootEvidence).toHaveBeenCalledTimes(2);
  });

  it('never falls back after owned evidence is denied', async () => {
    vi.mocked(fetchRootEvidence).mockRejectedValue(new Error('denied'));
    await expect(openCitationSource(makeCitation({ evidenceId: 'evidence', executionId: 'worker', source: 'doc.pdf' }),
      'sidebar', 'Source', { conversationId: 'conversation', messageId: 'message' })).rejects.toThrow('denied');
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    expect(openFileViewerFromUrlLoader).not.toHaveBeenCalled();
  });

  it('opens a web source only after owned evidence authorization, using the registered URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(fetchRootEvidence).mockResolvedValue({ evidenceId: 'evidence', kind: 'citation', producerAgentId: 'worker',
      url: 'https://sqlite.org/backup.html', fileName: 'Document' });
    await openCitationSource(makeCitation({ evidenceId: 'evidence', executionId: 'worker', sourceType: 'web',
      source: 'https://ignored.test' }), 'sidebar', 'Source', { conversationId: 'conversation', messageId: 'message' });
    expect(fetchRootEvidence).toHaveBeenCalledWith('conversation', 'worker', 'evidence');
    expect(openSpy).toHaveBeenCalledWith('https://sqlite.org/backup.html', '_blank', 'noopener,noreferrer');
    expect(openFileViewerFromUrlLoader).not.toHaveBeenCalled();
    vi.mocked(fetchRootEvidence).mockRejectedValueOnce(new Error('denied'));
    openSpy.mockClear();
    await expect(openCitationSource(makeCitation({ evidenceId: 'evidence', executionId: 'worker', sourceType: 'web',
      source: 'https://ignored.test' }), 'sidebar', 'Source', { conversationId: 'conversation', messageId: 'message' })).rejects.toThrow('denied');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens a registered web source when the first cached citation still looks like a document', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(fetchRootEvidence).mockResolvedValue({ evidenceId: 'evidence', kind: 'citation', sourceKind: 'web',
      producerAgentId: 'agent', url: 'https://official.test/source', fileName: '' });
    await openCitationSource(makeCitation({ sourceType: 'text', source: 'evidence:evidence', evidenceId: 'evidence', executionId: 'worker' }),
      'sidebar', 'Source', { conversationId: 'conversation', messageId: 'message' });
    expect(openSpy).toHaveBeenCalledWith('https://official.test/source', '_blank', 'noopener,noreferrer');
    expect(openFileViewerFromUrlLoader).not.toHaveBeenCalled();
  });

  it('preserves owned identity through the standalone citation renderer', async () => {
    vi.mocked(fetchRootEvidence).mockResolvedValue({
      evidenceId: 'evidence', kind: 'citation', producerAgentId: 'worker',
      url: 'https://storage.test/read', fileName: 'report.pdf', page: 13
    });
    render(<AIMessageContent parts={[{
      type: 'citation', ...makeCitation({
        source: 'report.pdf', reference: '7',
        evidenceId: 'evidence', executionId: 'worker'
      })
    }]} citationScope={{ conversationId: 'conversation', messageId: 'message' }} />);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    await waitFor(() => expect(fetchRootEvidence).toHaveBeenCalledWith('conversation', 'worker', 'evidence'));
    expect(vi.mocked(openFileViewerFromUrlLoader).mock.calls[0][4]).toMatchObject({ page: 13 });
  });

  it('rejects owned evidence without conversation scope', async () => {
    await expect(openCitationSource(makeCitation({ evidenceId: 'evidence', executionId: 'worker' }),
      'sidebar', 'Source')).rejects.toThrow('identity');
    expect(fetchRootEvidence).not.toHaveBeenCalled();
  });

  it.each([{ evidenceId: 'evidence' }, { executionId: 'worker' }, { evidenceId: '', executionId: 'worker' }])
    ('rejects incomplete owned identity without fallback: %o', async (identity) => {
      await expect(openCitationSource(makeCitation({ ...identity, source: 'doc.pdf' }), 'sidebar', 'Source',
        { conversationId: 'conversation', messageId: 'message' })).rejects.toThrow('identity');
      expect(fetchRootEvidence).not.toHaveBeenCalled();
      expect(getCitationViewUrl).not.toHaveBeenCalled();
    });

  it('opens a cited record in the record drawer, not the file viewer', async () => {
    const record = {
      modelId: 'm-1', modelName: 'Mails', data: 'published' as const, dataRevisionId: 'rev-1', entityId: 'e-1',
      concept: 'Contract', name: 'CT001', keyFields: { id: 'CT001' }
    };
    await openCitationSource(makeCitation({ sourceType: 'record', source: 'CT001', record }), 'sidebar', 'Source',
      { conversationId: 'conv-1', messageId: 'msg-1' });
    expect(useRecordCitationStore.getState().target).toEqual(record);
    expect(openFileViewerFromUrlLoader).not.toHaveBeenCalled();
    useRecordCitationStore.getState().close();
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
