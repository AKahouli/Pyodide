/**
 * Worky (Chief of Staff) — REST client.
 *
 * Part 1: stream lifecycle CRUD (list, get, create, patch).
 * Part 2: messages, board, plan-delta relay, interaction respond.
 * Part 3: execution lifecycle (start/pause/resume/stop), task ops,
 *   governance admin.
 * Part 4: budget, reports, memory (deferred).
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  CreateWorkyStreamData,
  SendWorkyMessageData,
  UpdateWorkyStreamData,
  WorkyBoardResponse,
  WorkyBudgetSnapshot,
  WorkyExecutionReport,
  WorkyGovernancePolicy,
  WorkyHumanUpdateKind,
  WorkyMemoryEntry,
  WorkyMemoryProposal,
  WorkyMessage,
  WorkyStartValidation,
  WorkyStream,
  WorkyStreamQueryParams,
  WorkyTask,
  WorkyTaskResult,
} from './types';

function unwrap<T>(response: { data: ApiResponse<T> }): T {
  return response.data.data;
}

export async function getStreams(params: WorkyStreamQueryParams = {}): Promise<WorkyStream[]> {
  const response = await apiClient.get<ApiResponse<WorkyStream[]>>(API_ENDPOINTS.worky.streams, {
    params,
  });
  return unwrap(response);
}

export async function getStream(streamId: string): Promise<WorkyStream> {
  const response = await apiClient.get<ApiResponse<WorkyStream>>(
    API_ENDPOINTS.worky.streamById(streamId),
  );
  return unwrap(response);
}

export async function createStream(data: CreateWorkyStreamData): Promise<WorkyStream> {
  const response = await apiClient.post<ApiResponse<WorkyStream>>(
    API_ENDPOINTS.worky.streams,
    data,
  );
  return unwrap(response);
}

export async function updateStream(
  streamId: string,
  data: UpdateWorkyStreamData,
): Promise<WorkyStream> {
  const response = await apiClient.patch<ApiResponse<WorkyStream>>(
    API_ENDPOINTS.worky.streamById(streamId),
    data,
  );
  return unwrap(response);
}

export async function getMessages(streamId: string, limit = 200): Promise<WorkyMessage[]> {
  const response = await apiClient.get<ApiResponse<WorkyMessage[]>>(
    API_ENDPOINTS.worky.streamMessages(streamId),
    { params: { limit } },
  );
  return unwrap(response);
}

export async function sendMessage(
  streamId: string,
  data: SendWorkyMessageData,
): Promise<{ id: string; content: string; createdAt: string; turnStarted: true }> {
  const response = await apiClient.post<
    ApiResponse<{ id: string; content: string; createdAt: string; turnStarted: true }>
  >(API_ENDPOINTS.worky.streamMessages(streamId), data);
  return unwrap(response);
}

export async function getBoard(streamId: string): Promise<WorkyBoardResponse> {
  const response = await apiClient.get<ApiResponse<WorkyBoardResponse>>(
    API_ENDPOINTS.worky.streamBoard(streamId),
  );
  return unwrap(response);
}

export async function respondInteraction(
  interactionId: string,
  content: string,
  options: { cancel?: boolean; approve?: boolean } = {},
): Promise<{
  interactionId: string;
  streamId: string;
  status: 'responded' | 'canceled';
  response: string;
  verdict: 'approved' | 'rejected' | null;
  followUpTurnStarted: boolean;
}> {
  const response = await apiClient.post<
    ApiResponse<{
      interactionId: string;
      streamId: string;
      status: 'responded' | 'canceled';
      response: string;
      verdict: 'approved' | 'rejected' | null;
      followUpTurnStarted: boolean;
    }>
  >(API_ENDPOINTS.worky.respondInteraction(interactionId), {
    content,
    cancel: options.cancel ?? false,
    approve: options.approve,
  });
  return unwrap(response);
}

export async function startStream(streamId: string): Promise<WorkyStartValidation> {
  const response = await apiClient.post<ApiResponse<WorkyStartValidation>>(
    API_ENDPOINTS.worky.streamStart(streamId),
  );
  return unwrap(response);
}

export async function pauseStream(
  streamId: string,
  reason?: string,
): Promise<{ ok: true }> {
  const response = await apiClient.post<ApiResponse<{ ok: true }>>(
    API_ENDPOINTS.worky.streamPause(streamId),
    { reason },
  );
  return unwrap(response);
}

export async function resumeStream(
  streamId: string,
  reason?: string,
): Promise<{ ok: true }> {
  const response = await apiClient.post<ApiResponse<{ ok: true }>>(
    API_ENDPOINTS.worky.streamResume(streamId),
    { reason },
  );
  return unwrap(response);
}

export async function stopStream(
  streamId: string,
  reason?: string,
): Promise<{ ok: true }> {
  const response = await apiClient.delete<ApiResponse<{ ok: true }>>(
    API_ENDPOINTS.worky.streamStop(streamId),
    { data: { reason } },
  );
  return unwrap(response);
}

export async function moveTask(
  taskId: string,
  lane: string,
  reason?: string,
): Promise<WorkyTask> {
  const response = await apiClient.post<ApiResponse<WorkyTask>>(
    API_ENDPOINTS.worky.taskMove(taskId),
    { lane, reason },
  );
  return unwrap(response);
}

export async function pauseTask(taskId: string, reason?: string): Promise<WorkyTask> {
  const response = await apiClient.post<ApiResponse<WorkyTask>>(
    API_ENDPOINTS.worky.taskPause(taskId),
    { reason },
  );
  return unwrap(response);
}

export async function resumeTask(taskId: string, reason?: string): Promise<WorkyTask> {
  const response = await apiClient.post<ApiResponse<WorkyTask>>(
    API_ENDPOINTS.worky.taskResume(taskId),
    { reason },
  );
  return unwrap(response);
}

export async function cancelTask(taskId: string, reason?: string): Promise<WorkyTask> {
  const response = await apiClient.post<ApiResponse<WorkyTask>>(
    API_ENDPOINTS.worky.taskCancel(taskId),
    { reason },
  );
  return unwrap(response);
}

export async function reviewTask(taskId: string, reason?: string): Promise<WorkyTask> {
  const response = await apiClient.post<ApiResponse<WorkyTask>>(
    API_ENDPOINTS.worky.taskReview(taskId),
    { reason },
  );
  return unwrap(response);
}

export async function getTaskResults(taskId: string): Promise<WorkyTaskResult[]> {
  const response = await apiClient.get<ApiResponse<WorkyTaskResult[]>>(
    API_ENDPOINTS.worky.taskResults(taskId),
  );
  return unwrap(response);
}

export async function getGovernancePolicy(workspaceId: string): Promise<WorkyGovernancePolicy> {
  const response = await apiClient.get<ApiResponse<WorkyGovernancePolicy>>(
    API_ENDPOINTS.worky.governancePolicy,
    { params: { workspaceId } },
  );
  return unwrap(response);
}

export async function upsertGovernancePolicy(
  policy: WorkyGovernancePolicy,
): Promise<WorkyGovernancePolicy> {
  const response = await apiClient.post<ApiResponse<WorkyGovernancePolicy>>(
    API_ENDPOINTS.worky.governancePolicy,
    policy,
  );
  return unwrap(response);
}

// =================================================================
// Part 4 — budget, reports, memory, human Kanban updates
// =================================================================

export async function getStreamBudget(streamId: string): Promise<WorkyBudgetSnapshot> {
  const response = await apiClient.get<ApiResponse<WorkyBudgetSnapshot>>(
    API_ENDPOINTS.worky.streamBudget(streamId),
  );
  return unwrap(response);
}

export async function updateStreamBudget(
  streamId: string,
  data: { limitUsd: number; limitTokens: number; enforcement: 'hard_stop' | 'notify' },
): Promise<WorkyBudgetSnapshot> {
  const response = await apiClient.patch<ApiResponse<WorkyBudgetSnapshot>>(
    API_ENDPOINTS.worky.streamBudget(streamId),
    data,
  );
  return unwrap(response);
}

export async function humanUpdateTask(
  taskId: string,
  kind: WorkyHumanUpdateKind,
  comment?: string,
): Promise<{ taskId: string; kind: string; lane: string; executionState: string }> {
  const response = await apiClient.post<
    ApiResponse<{ taskId: string; kind: string; lane: string; executionState: string }>
  >(API_ENDPOINTS.worky.taskHumanUpdate(taskId), { kind, comment });
  return unwrap(response);
}

export async function getExecutionReport(streamId: string): Promise<WorkyExecutionReport | null> {
  const response = await apiClient.get<ApiResponse<WorkyExecutionReport | null>>(
    API_ENDPOINTS.worky.executionReport(streamId),
  );
  return unwrap(response);
}

export async function generateExecutionReport(streamId: string): Promise<WorkyExecutionReport> {
  const response = await apiClient.post<ApiResponse<WorkyExecutionReport>>(
    API_ENDPOINTS.worky.executionReport(streamId),
  );
  return unwrap(response);
}

export async function listMemoryProposals(
  status?: 'pending' | 'confirmed' | 'rejected',
): Promise<WorkyMemoryProposal[]> {
  const response = await apiClient.get<ApiResponse<WorkyMemoryProposal[]>>(
    API_ENDPOINTS.worky.memoryProposals,
    { params: status ? { status } : undefined },
  );
  return unwrap(response);
}

export async function listMemoryEntries(): Promise<WorkyMemoryEntry[]> {
  const response = await apiClient.get<ApiResponse<WorkyMemoryEntry[]>>(
    API_ENDPOINTS.worky.memoryEntries,
  );
  return unwrap(response);
}

export async function confirmMemoryProposal(proposalId: string): Promise<WorkyMemoryEntry> {
  const response = await apiClient.post<ApiResponse<WorkyMemoryEntry>>(
    API_ENDPOINTS.worky.memoryProposalConfirm(proposalId),
    {},
  );
  return unwrap(response);
}

export async function rejectMemoryProposal(
  proposalId: string,
  reason?: string,
): Promise<WorkyMemoryProposal> {
  const response = await apiClient.post<ApiResponse<WorkyMemoryProposal>>(
    API_ENDPOINTS.worky.memoryProposalReject(proposalId),
    { reason },
  );
  return unwrap(response);
}
