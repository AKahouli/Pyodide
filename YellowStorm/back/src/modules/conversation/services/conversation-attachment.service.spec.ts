import { ConversationAttachmentService } from './conversation-attachment.service';
import type { DocumentResponse } from '../../workspace';

const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function doc(overrides: Partial<DocumentResponse>): DocumentResponse {
  return {
    id: 'doc-1',
    workspaceId: 'system-1',
    originalName: 'notes.txt',
    filename: 'stored-notes.txt',
    mimeType: 'text/plain',
    size: 100,
    path: 'user-1/conversation-1/notes.txt',
    status: 'completed',
    isFolder: false,
    type: 'doc',
    indexingStatus: 'none',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as DocumentResponse;
}

const pdfProfile = {
  version: 1,
  documentId: 'doc-1',
  filename: 'notes.pdf',
  mimeType: 'application/pdf',
  extraction: { status: 'ready', extractor: 'pymupdf', characters: 1200, truncated: false },
  content: '--- Page 1 ---\nhello',
  generatedAt: '2026-01-01T00:00:00Z',
};

describe('ConversationAttachmentService', () => {
  let upload: jest.Mock;
  let queueDocument: jest.Mock;
  let mergeMetadata: jest.Mock;
  let axiosPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildService(overrides: { profileResponse?: unknown; profileError?: Error } = {}) {
    upload = jest.fn().mockResolvedValue({});
    queueDocument = jest.fn().mockResolvedValue(undefined);
    mergeMetadata = jest.fn().mockResolvedValue(undefined);
    const configGet = jest.fn((key: string) => (key === 'indexing.apiAdk' ? 'http://adk' : ''));
    axiosPost = jest.fn();
    if (overrides.profileError) axiosPost.mockRejectedValue(overrides.profileError);
    // requestProfile is replaced outright, so it resolves with the profile
    // itself (already unwrapped from the HTTP response).
    else axiosPost.mockResolvedValue(overrides.profileResponse);

    const service = new ConversationAttachmentService(
      { get: configGet } as never,
      { mergeMetadata } as never,
      { upload } as never,
      { queueDocument } as never,
      logger as never,
    );
    (service as unknown as { requestProfile: jest.Mock }).requestProfile = axiosPost as never;

    return service;
  }

  it('marks a normal document SEARCHABLE and queues search indexing', async () => {
    const service = buildService({ profileResponse: pdfProfile });

    const prepared = await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'notes.pdf', mimeType: 'application/pdf' })], 5000);

    expect(prepared[0].policy).toBe('SEARCHABLE');
    expect(prepared[0].searchIndexAllowed).toBe(true);
    expect(queueDocument).toHaveBeenCalledWith('doc-1');
    expect(mergeMetadata).toHaveBeenCalledWith('system-1', 'doc-1', expect.objectContaining({ attachmentPolicy: 'SEARCHABLE' }));
  });

  it('never indexes a CSV above the row threshold (CODE_ONLY)', async () => {
    const service = buildService({
      profileResponse: {
        ...pdfProfile,
        extraction: { status: 'ready', extractor: 'tabular-probe', characters: 0, truncated: false },
        tabular: { totalRows: 5001, columnNames: ['id'] },
        content: null,
      },
    });

    const prepared = await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'big.csv', mimeType: 'text/csv' })], 5000);

    expect(prepared[0].policy).toBe('CODE_ONLY');
    expect(prepared[0].searchIndexAllowed).toBe(false);
    expect(queueDocument).not.toHaveBeenCalled();
  });

  it('allows a CSV at or below the threshold', async () => {
    const service = buildService({
      profileResponse: {
        ...pdfProfile,
        extraction: { status: 'ready', extractor: 'tabular-probe', characters: 20, truncated: false },
        tabular: { totalRows: 5000, columnNames: ['id'] },
      },
    });

    const prepared = await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'ok.csv', mimeType: 'text/csv' })], 5000);

    expect(prepared[0].policy).toBe('SEARCHABLE');
    expect(prepared[0].rowCount).toBe(5000);
    expect(queueDocument).toHaveBeenCalledWith('doc-1');
  });

  it('fails closed to CODE_ONLY when the tabular probe errors', async () => {
    const service = buildService({ profileError: new Error('timeout') });

    const prepared = await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })], 5000);

    expect(prepared[0].policy).toBe('CODE_ONLY');
    expect(prepared[0].searchIndexAllowed).toBe(false);
    expect(queueDocument).not.toHaveBeenCalled();
  });

  it('falls back to TEXT_ONLY (metadata only, no indexing) when a document probe errors', async () => {
    const service = buildService({ profileError: new Error('timeout') });

    const prepared = await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'notes.pdf', mimeType: 'application/pdf' })], 5000);

    expect(prepared[0].policy).toBe('TEXT_ONLY');
    expect(prepared[0].searchIndexAllowed).toBe(false);
    expect(queueDocument).not.toHaveBeenCalled();
  });

  it('reuses the persisted policy without re-extracting (idempotent replay)', async () => {
    const service = buildService({ profileResponse: pdfProfile });

    const prepared = await service.prepareAttachments(
      'user-1',
      'conv-1',
      [doc({ metadata: { attachmentPolicy: 'CODE_ONLY', attachmentProfilePath: 'user-1/conv-1/.attachment-context/doc-1/profile-v1.json' } })],
      5000,
    );

    expect(prepared[0].policy).toBe('CODE_ONLY');
    expect(axiosPost).not.toHaveBeenCalled();
    expect(queueDocument).not.toHaveBeenCalled();
  });

  it('stores the profile sidecar next to the conversation workspace prefix', async () => {
    const service = buildService({ profileResponse: pdfProfile });

    await service.prepareAttachments('user-1', 'conv-1', [doc({ originalName: 'notes.pdf', mimeType: 'application/pdf' })], 5000);

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'profile-v1.json',
      'application/json',
      expect.objectContaining({ folder: 'user-1/conv-1/.attachment-context/doc-1' }),
    );
  });
});
