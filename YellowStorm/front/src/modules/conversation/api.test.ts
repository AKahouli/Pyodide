import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { branchConversation, createConversation, deleteConversation, fetchActiveStream, fetchRootInputs, fetchRootResult, fetchRootEvidence, fetchConversations, fetchMessages, getArtifactDownloadUrl, getCitationViewUrl, rerunReliabilityEvaluation, sendMessage } from './api';

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  API_ENDPOINTS: {
    conversations: {
      list: '/conversations',
      create: '/conversations',
      byId: (id: string) => `/conversations/${id}`,
      branch: (id: string) => `/conversations/${id}/branches`,
      messages: (id: string) => `/conversations/${id}/messages`,
      activeStream: (id: string) => `/conversations/${id}/active-stream`,
      rootInputs: (id: string) => `/conversations/${id}/root-inputs`,
      rootResult: (id: string, executionId: string) => `/conversations/${id}/root-results/${executionId}`,
      rootEvidence: (id: string, executionId: string, evidenceId: string) => `/conversations/${id}/root-results/${executionId}/evidence/${evidenceId}`,
      messageById: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}`,
      feedback: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/feedback`,
      rerunReliabilityEvaluation: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/reliability-evaluation/rerun`,
      stop: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/stop`,
      regenerate: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/regenerate`,
      branches: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/branches`,
      report: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/report`,
      artifactUrl: (cid: string, mid: string, aid: string) => `/conversations/${cid}/messages/${mid}/artifacts/${aid}/url`,
      citationUrl: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/citations/url`,
      workspaceDocuments: (cid: string) => `/conversations/${cid}/workspace-documents`,
      fileUploadUrl: (cid: string) => `/conversations/${cid}/files/upload-url`,
      fileConfirm: (cid: string) => `/conversations/${cid}/files/confirm`,
      fileDelete: (cid: string, did: string) => `/conversations/${cid}/files/${did}`,
      share: (cid: string) => `/conversations/${cid}/share`,
      shares: (cid: string) => `/conversations/${cid}/shares`,
      revokeShare: (cid: string, sid: string) => `/conversations/${cid}/shares/${sid}`,
      publicShare: (token: string) => `/conversations/public/${token}`,
    },
  },
}));

describe('conversation api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads private native inputs using the shared client with cancellation', async () => {
    const inputs = [{ executionId: 'execution', epoch: 2, inputs: [{ inputId: 'input', inputVersion: 1, kind: 'confirmation' }] }];
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: inputs } } as never);
    const signal = new AbortController().signal;
    expect(await fetchRootInputs('conversation', signal)).toEqual(inputs);
    expect(apiClient.get).toHaveBeenCalledWith('/conversations/conversation/root-inputs', { signal });
  });

  it('loads an authorized full child result using the shared client', async () => {
    const result = { executionId: 'child', text: 'full output', complete: true };
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: result } } as never);
    const signal = new AbortController().signal;
    expect(await fetchRootResult('conversation', 'child', signal)).toEqual(result);
    expect(apiClient.get).toHaveBeenCalledWith('/conversations/conversation/root-results/child', { signal });
  });

  it('resolves a registered evidence location using the shared client', async () => {
    const location = { evidenceId: 'evidence', kind: 'artifact', producerAgentId: 'worker', url: 'https://storage.test/file', fileName: 'file.txt' };
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: location } } as never);
    const signal = new AbortController().signal;
    expect(await fetchRootEvidence('conversation', 'child', 'evidence', signal)).toEqual(location);
    expect(apiClient.get).toHaveBeenCalledWith('/conversations/conversation/root-results/child/evidence/evidence', { signal });
  });

  it('maps paginated conversations response', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        data: {
          conversations: [{ id: 'c1', title: 'Test' }],
          pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
        },
      },
    } as never);

    const result = await fetchConversations({ page: 1, limit: 12 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('returns separate artifact view and download URLs', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { data: { viewUrl: 'https://storage.example/view', downloadUrl: 'https://storage.example/download' } },
    } as never);

    await expect(getArtifactDownloadUrl('conversation-1', 'message-1', 'artifact-1')).resolves.toEqual({
      viewUrl: 'https://storage.example/view',
      downloadUrl: 'https://storage.example/download',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/conversations/conversation-1/messages/message-1/artifacts/artifact-1/url');
  });

  it('resolves a citation through its scoped message route', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { data: { url: 'https://storage.example/report', fileName: 'report.pdf', mimeType: 'application/pdf' } },
    } as never);

    await expect(getCitationViewUrl('conversation-1', 'message-1', {
      source: 'deepsearch', fileName: 'report.pdf', reference: '2',
    })).resolves.toEqual({ url: 'https://storage.example/report', fileName: 'report.pdf', mimeType: 'application/pdf' });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/conversations/conversation-1/messages/message-1/citations/url',
      { source: 'deepsearch', fileName: 'report.pdf', reference: '2' },
    );
  });

  it('forwards the platform-copilot history filter', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { data: { conversations: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } } },
    } as never);

    await fetchConversations({ runtimePurpose: 'platform_copilot', page: 1, limit: 50 });

    expect(apiClient.get).toHaveBeenCalledWith('/conversations', {
      params: { runtimePurpose: 'platform_copilot', page: 1, limit: 50 },
    });
  });

  it('creates conversation and returns mapped data', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { data: { id: 'c2', title: 'New' } } } as never);
    const result = await createConversation({ title: 'New' });
    expect(result.id).toBe('c2');
  });

  it('forwards an idempotent platform-copilot creation identity', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { data: { id: 'c3', title: 'Yellowmind' } } } as never);
    const payload = {
      runtimePurpose: 'platform_copilot' as const,
      creationRequestId: '927ea1f2-5e0b-4a23-a352-b29fe8d33e0c',
    };

    await createConversation(payload);

    expect(apiClient.post).toHaveBeenCalledWith('/conversations', payload);
  });

  it('maps paginated messages and sends message', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        data: {
          messages: [{ id: 'm1', conversationId: 'c1', conversationType: 'user', createdAt: new Date().toISOString() }],
          pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
        },
      },
    } as never);
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        data: {
          userMessage: { id: 'm2', conversationId: 'c1', conversationType: 'user', createdAt: new Date().toISOString() },
        },
      },
    } as never);

    const messages = await fetchMessages('c1', { page: 1, limit: 5 });
    const sent = await sendMessage('c1', { content: 'hello' });

    expect(messages.items[0]?.id).toBe('m1');
    expect(sent.userMessage.id).toBe('m2');
  });

  it('fetches the active process-local stream snapshot', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { data: { conversationId: 'c1', messageId: 'm1', revision: 2, components: [] } },
    } as never);

    await expect(fetchActiveStream('c1')).resolves.toEqual({
      conversationId: 'c1', messageId: 'm1', revision: 2, components: [],
    });
    expect(apiClient.get).toHaveBeenCalledWith('/conversations/c1/active-stream');
  });

  it('deletes conversation', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({} as never);
    await deleteConversation('c3');
    expect(apiClient.delete).toHaveBeenCalled();
  });

  it('creates a branch using message IDs only', async () => {
    const payload = {
      requestId: '64fcf421-dd8f-44d5-ad38-f7f1169fd810',
      targetMessageId: 'ai-2',
      activeBranches: { 'user-1': 'ai-2' },
    };
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { data: { id: 'branch-1' } } } as never);

    const result = await branchConversation('source-1', payload);

    expect(apiClient.post).toHaveBeenCalledWith('/conversations/source-1/branches', payload);
    expect(result.id).toBe('branch-1');
  });

  it('queues a reliability rerun without a request body', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { data: { messageId: 'm1', reliabilityEvaluation: { status: 'pending', requestedAt: '2026-07-29T10:00:00.000Z' } } },
    } as never);

    const result = await rerunReliabilityEvaluation('c1', 'm1');

    expect(apiClient.post).toHaveBeenCalledWith('/conversations/c1/messages/m1/reliability-evaluation/rerun');
    expect(result.reliabilityEvaluation.status).toBe('pending');
  });
});
