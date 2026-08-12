import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { branchConversation, createConversation, deleteConversation, fetchConversations, fetchMessages, rerunReliabilityEvaluation, sendMessage } from './api';

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
      messageById: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}`,
      feedback: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/feedback`,
      rerunReliabilityEvaluation: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/reliability-evaluation/rerun`,
      stop: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/stop`,
      regenerate: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/regenerate`,
      branches: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/branches`,
      report: (cid: string, mid: string) => `/conversations/${cid}/messages/${mid}/report`,
      artifactUrl: '/conversations/artifact-url',
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

  it('creates conversation and returns mapped data', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { data: { id: 'c2', title: 'New' } } } as never);
    const result = await createConversation({ title: 'New' });
    expect(result.id).toBe('c2');
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
