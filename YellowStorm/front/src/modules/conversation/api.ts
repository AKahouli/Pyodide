import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type { Conversation, Message, ConversationListParams, MessageListParams, PaginatedResponse, SendMessagePayload, CreateReportPayload, CreateSharePayload, ShareResponse, PublicShareViewResponse } from './types';

// ===== Conversation APIs =====

interface BackendPaginatedConversations {
  conversations: Conversation[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface BackendPaginatedMessages {
  messages: Message[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchConversations(params?: ConversationListParams): Promise<PaginatedResponse<Conversation>> {
  const response = await apiClient.get<ApiResponse<BackendPaginatedConversations>>(API_ENDPOINTS.conversations.list, { params });
  const data = response.data.data;
  return {
    items: data.conversations || [],
    total: data.pagination.total,
    page: data.pagination.page,
    limit: data.pagination.limit,
    totalPages: data.pagination.totalPages,
  };
}

export async function createConversation(data?: { title?: string; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }>; ownerJob?: string }): Promise<Conversation> {
  const response = await apiClient.post<ApiResponse<Conversation>>(API_ENDPOINTS.conversations.create, data || {});
  return response.data.data;
}

export async function fetchConversation(id: string): Promise<Conversation> {
  const response = await apiClient.get<ApiResponse<Conversation>>(API_ENDPOINTS.conversations.byId(id));
  return response.data.data;
}

export async function updateConversation(id: string, data: { title?: string; isArchived?: boolean; workspaces?: string[]; participantEmails?: string[]; participants?: Array<{ email: string; job?: string }> }): Promise<Conversation> {
  const response = await apiClient.patch<ApiResponse<Conversation>>(API_ENDPOINTS.conversations.byId(id), data);
  return response.data.data;
}

export async function deleteConversation(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.conversations.byId(id));
}

export async function joinConversation(id: string): Promise<Conversation> {
  const response = await apiClient.post<ApiResponse<Conversation>>(API_ENDPOINTS.conversations.join(id));
  return response.data.data;
}

export async function removeConversationMember(conversationId: string, memberId: string): Promise<Conversation> {
  const response = await apiClient.delete<ApiResponse<Conversation>>(`${API_ENDPOINTS.conversations.byId(conversationId)}/members/${memberId}`);
  return response.data.data;
}

export async function updateConversationMemberJob(conversationId: string, memberId: string, job: string): Promise<Conversation> {
  const response = await apiClient.patch<ApiResponse<Conversation>>(`${API_ENDPOINTS.conversations.byId(conversationId)}/members/${memberId}/job`, { job });
  return response.data.data;
}

export async function fetchTaggedAgents(id: string): Promise<any[]> {
  const response = await apiClient.get<ApiResponse<any[]>>(API_ENDPOINTS.conversations.taggedAgents(id));
  return response.data.data;
}

// ===== Message APIs =====

export async function fetchMessages(conversationId: string, params?: MessageListParams): Promise<PaginatedResponse<Message>> {
  const response = await apiClient.get<ApiResponse<BackendPaginatedMessages>>(API_ENDPOINTS.conversations.messages(conversationId), { params });
  const data = response.data.data;
  return {
    items: data.messages || [],
    total: data.pagination.total,
    page: data.pagination.page,
    limit: data.pagination.limit,
    totalPages: data.pagination.totalPages,
  };
}

export async function sendMessage(conversationId: string, payload: SendMessagePayload): Promise<{ userMessage: Message }> {
  const response = await apiClient.post<ApiResponse<{ userMessage: Message }>>(API_ENDPOINTS.conversations.messages(conversationId), payload);
  return response.data.data;
}

export async function fetchMessage(conversationId: string, messageId: string): Promise<Message> {
  const response = await apiClient.get<ApiResponse<Message>>(API_ENDPOINTS.conversations.messageById(conversationId, messageId));
  return response.data.data;
}

export async function updateFeedback(conversationId: string, messageId: string, feedback: 'like' | 'dislike' | null): Promise<Message> {
  const response = await apiClient.patch<ApiResponse<Message>>(API_ENDPOINTS.conversations.feedback(conversationId, messageId), { feedback });
  return response.data.data;
}

export async function stopStream(conversationId: string, messageId: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.conversations.stop(conversationId, messageId));
}

export async function regenerateMessage(conversationId: string, messageId: string): Promise<{ aiMessage: Message }> {
  const response = await apiClient.post<ApiResponse<{ aiMessage: Message }>>(API_ENDPOINTS.conversations.regenerate(conversationId, messageId));
  return response.data.data;
}

export async function updateMessage(conversationId: string, messageId: string, content: string, agentIds?: string[], memberIds?: string[]): Promise<Message> {
  const response = await apiClient.patch<ApiResponse<Message>>(API_ENDPOINTS.conversations.messageById(conversationId, messageId), { content, agentIds, memberIds });
  return response.data.data;
}

export async function markMentionSeen(conversationId: string, messageId: string): Promise<void> {
  await apiClient.patch(API_ENDPOINTS.conversations.markMentionSeen(conversationId, messageId));
}

export async function fetchBranches(conversationId: string, userMessageId: string): Promise<Message[]> {
  const response = await apiClient.get<ApiResponse<Message[]>>(API_ENDPOINTS.conversations.branches(conversationId, userMessageId));
  return response.data.data;
}

export async function reportMessage(conversationId: string, messageId: string, payload: CreateReportPayload): Promise<void> {
  await apiClient.post(API_ENDPOINTS.conversations.report(conversationId, messageId), payload);
}

export async function getArtifactDownloadUrl(filePath: string, filename?: string): Promise<{ downloadUrl: string }> {
  const response = await apiClient.post<ApiResponse<{ downloadUrl: string }>>(API_ENDPOINTS.conversations.artifactUrl, { filePath, filename });
  return response.data.data;
}

export async function fetchComposerSuggestions(
  partialText: string,
  signal?: AbortSignal,
  agentId?: string,
): Promise<{ content: string }> {
  console.log('[ComposerSuggestions API] Fetching suggestions:', {
    endpoint: API_ENDPOINTS.conversations.composerSuggestions,
    partialTextLength: partialText.length,
    partialTextPreview: partialText.substring(0, 50),
    agentId,
  });
  const response = await apiClient.post<ApiResponse<{ content: string }>>(
    API_ENDPOINTS.conversations.composerSuggestions,
    { partialText, agentId },
    { signal },
  );
  console.log('[ComposerSuggestions API] Response received:', {
    contentLength: response.data.data.content?.length,
    contentPreview: response.data.data.content?.substring(0, 100),
  });
  return response.data.data;
}

// ===== Workspace Documents APIs =====

interface BackendPaginatedDocuments {
  documents: Array<{
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    workspaceId: string;
    status: string;
    indexingStatus: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: unknown;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchConversationWorkspaceDocuments(conversationId: string, params?: { page?: number; limit?: number }): Promise<BackendPaginatedDocuments> {
  const response = await apiClient.get<ApiResponse<BackendPaginatedDocuments>>(API_ENDPOINTS.conversations.workspaceDocuments(conversationId), { params });
  return response.data.data;
}

// ===== Conversation File APIs =====

export interface FileUploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface DocumentResponse {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  [key: string]: unknown;
}

export async function requestFileUploadUrl(conversationId: string, data: { filename: string; mimeType: string; size: number }): Promise<FileUploadUrlResponse> {
  const response = await apiClient.post<ApiResponse<FileUploadUrlResponse>>(API_ENDPOINTS.conversations.fileUploadUrl(conversationId), data);
  return response.data.data;
}

export async function confirmFileUpload(conversationId: string, documentId: string): Promise<DocumentResponse> {
  const response = await apiClient.post<ApiResponse<DocumentResponse>>(API_ENDPOINTS.conversations.fileConfirm(conversationId), { documentId });
  return response.data.data;
}

export async function deleteConversationFile(conversationId: string, documentId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.conversations.fileDelete(conversationId, documentId));
}

// ===== Share APIs =====

export async function createShare(conversationId: string, payload: CreateSharePayload): Promise<ShareResponse> {
  const response = await apiClient.post<ApiResponse<ShareResponse>>(API_ENDPOINTS.conversations.share(conversationId), payload);
  return response.data.data;
}

export async function getShares(conversationId: string): Promise<ShareResponse[]> {
  const response = await apiClient.get<ApiResponse<ShareResponse[]>>(API_ENDPOINTS.conversations.shares(conversationId));
  return response.data.data;
}

export async function revokeShare(conversationId: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.conversations.revokeShare(conversationId, shareId));
}

export async function viewPublicShare(accessToken: string): Promise<PublicShareViewResponse> {
  const response = await apiClient.get<ApiResponse<PublicShareViewResponse>>(API_ENDPOINTS.conversations.publicShare(accessToken));
  return response.data.data;
}
