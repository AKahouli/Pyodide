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
  WorkyHumainRef,
  WorkyHumanUpdateKind,
  WorkyMemoryEntry,
  WorkyMemoryProposal,
  WorkyMessage,
  WorkyStartValidation,
  WorkyStream,
  WorkyStreamQueryParams,
  WorkyTask,
  WorkyTaskResult,
  WorkyWhatsAppConnectResponse,
  WorkyWhatsAppIntegration,
  WorkyWhatsAppPairingResponse,
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

/**
 * Resolve humain agents by id. Used to render task assignees that are other
 * users' humain agents delegated into a stream (not in the caller's own
 * roster). Humain-only + active on the server, so no private agent leaks.
 */
export async function resolveHumainAgents(ids: string[]): Promise<WorkyHumainRef[]> {
  if (ids.length === 0) return [];
  const response = await apiClient.get<ApiResponse<WorkyHumainRef[]>>(
    API_ENDPOINTS.agents.humainResolve,
    { params: { ids: ids.join(',') } },
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

/**
 * Cancel the running orchestrator turn via the StopSession RPC.
 * Unlike stopStream (which tears down the stream lifecycle), this just
 * stops the in-flight Manager turn.
 */
export async function stopTurn(streamId: string): Promise<{ stopped: boolean }> {
  const response = await apiClient.post<ApiResponse<{ stopped: boolean }>>(
    API_ENDPOINTS.worky.streamStopTurn(streamId),
  );
  return unwrap(response);
}

/**
 * Pause the running orchestrator turn via the PauseSession RPC.
 * Non-terminal — the plan is kept and continues when the next message is sent.
 */
export async function pauseTurn(streamId: string): Promise<{ paused: boolean }> {
  const response = await apiClient.post<ApiResponse<{ paused: boolean }>>(
    API_ENDPOINTS.worky.streamPauseTurn(streamId),
  );
  return unwrap(response);
}

/**
 * Resume a paused orchestrator session — continues the remaining steps via a
 * RunTask (no new owner message).
 */
export async function resumeTurn(streamId: string): Promise<{ resumed: boolean }> {
  const response = await apiClient.post<ApiResponse<{ resumed: boolean }>>(
    API_ENDPOINTS.worky.streamResumeTurn(streamId),
  );
  return unwrap(response);
}

export async function deleteStream(
  streamId: string,
): Promise<{ ok: true; deletedWorkspaceId: string | null }> {
  const response = await apiClient.delete<ApiResponse<{ ok: true; deletedWorkspaceId: string | null }>>(
    API_ENDPOINTS.worky.streamDelete(streamId),
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

// =================================================================
// Speech-to-text — voice composer
// =================================================================

/**
 * Upload a recorded audio clip and get back its transcript. The backend
 * proxies it to OpenRouter's Whisper transcription (auto-detects EN/FR). The
 * clip is sent as multipart/form-data under the `file` field.
 */
export async function transcribeAudio(
  blob: Blob,
  filename = 'speech.webm',
): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  form.append('file', blob, filename);
  const response = await apiClient.post<ApiResponse<{ text: string; language?: string }>>(
    API_ENDPOINTS.worky.sttTranscribe,
    form,
    // The shared client defaults to application/json; clearing it lets the
    // browser set multipart/form-data with the correct boundary.
    { headers: { 'Content-Type': undefined } },
  );
  return unwrap(response);
}

/**
 * Synthesize spoken audio for an agent answer via OpenRouter TTS (proxied by
 * the backend). Returns the audio as a Blob for playback.
 */
export async function synthesizeSpeech(
  text: string,
  voice?: string,
  speed?: number,
): Promise<Blob> {
  const response = await apiClient.post(
    API_ENDPOINTS.worky.ttsSpeak,
    { text, voice, speed },
    { responseType: 'blob' },
  );
  return response.data as Blob;
}

// =================================================================
// Realtime voice concierge (Gemini Live via backend-minted token)
// =================================================================

/** Opaque connection descriptor for a Gemini Live session (all config server-bound). */
export interface VoiceSessionEnvelope {
  wsUrl: string;
  setup: Record<string, unknown>;
  expiresAt: string;
}

/** Mint a locked, single-use Gemini Live session token via the BFF. */
export async function createVoiceSession(streamId: string, resumptionHandle?: string): Promise<VoiceSessionEnvelope> {
  const res = await apiClient.post<ApiResponse<VoiceSessionEnvelope>>(API_ENDPOINTS.worky.voiceSession, {
    streamId,
    resumptionHandle,
  });
  return unwrap(res);
}

/** Get the per-stream concierge prompt (or the default when unset). */
export async function getVoicePrompt(streamId: string): Promise<{ prompt: string; isDefault: boolean }> {
  const res = await apiClient.get<ApiResponse<{ prompt: string; isDefault: boolean }>>(
    API_ENDPOINTS.worky.voicePrompt(streamId),
  );
  return unwrap(res);
}

/** Save the per-stream concierge prompt; a blank prompt resets to the default. */
export async function setVoicePrompt(streamId: string, prompt: string): Promise<{ prompt: string; isDefault: boolean }> {
  const res = await apiClient.put<ApiResponse<{ prompt: string; isDefault: boolean }>>(
    API_ENDPOINTS.worky.voicePrompt(streamId),
    { prompt },
  );
  return unwrap(res);
}

/** Voice tool: dispatch a worky task (server runs the orchestrator gRPC call). */
export async function voiceDispatch(
  streamId: string,
  message: string,
): Promise<{ runId: string; sessionId: string; accepted: boolean }> {
  const res = await apiClient.post<ApiResponse<{ runId: string; sessionId: string; accepted: boolean }>>(
    API_ENDPOINTS.worky.voiceDispatch,
    { streamId, message },
  );
  return unwrap(res);
}

/** Voice tool: read the current worky task status/plan. */
export async function voiceStatus(streamId: string): Promise<{ status: string; title: string; plan: unknown }> {
  const res = await apiClient.post<ApiResponse<{ status: string; title: string; plan: unknown }>>(
    API_ENDPOINTS.worky.voiceStatus,
    { streamId },
  );
  return unwrap(res);
}

/** Persist a voice transcript turn into the unified chat history. */
export async function voiceTranscript(streamId: string, role: 'owner' | 'manager', text: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.worky.voiceTranscript, { streamId, role, text });
}

// =================================================================
// WhatsApp integration (per stream)
// =================================================================

export async function getWorkyWhatsAppIntegration(
  streamId: string,
): Promise<WorkyWhatsAppIntegration | null> {
  const response = await apiClient.get<ApiResponse<WorkyWhatsAppIntegration | null>>(
    API_ENDPOINTS.worky.whatsappIntegration(streamId),
  );
  return unwrap(response);
}

export async function connectWorkyWhatsApp(
  streamId: string,
): Promise<WorkyWhatsAppConnectResponse> {
  const response = await apiClient.post<ApiResponse<WorkyWhatsAppConnectResponse>>(
    API_ENDPOINTS.worky.whatsappConnect(streamId),
  );
  return unwrap(response);
}

export async function getWorkyWhatsAppPairing(
  streamId: string,
  sessionId: string,
): Promise<WorkyWhatsAppPairingResponse> {
  const response = await apiClient.get<ApiResponse<WorkyWhatsAppPairingResponse>>(
    API_ENDPOINTS.worky.whatsappPairing(streamId, sessionId),
  );
  return unwrap(response);
}

export async function reconnectWorkyWhatsApp(
  streamId: string,
  sessionId: string,
): Promise<WorkyWhatsAppIntegration> {
  const response = await apiClient.post<ApiResponse<WorkyWhatsAppIntegration>>(
    API_ENDPOINTS.worky.whatsappReconnect(streamId, sessionId),
  );
  return unwrap(response);
}

export async function disconnectWorkyWhatsAppSession(
  streamId: string,
  sessionId: string,
): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.worky.whatsappSession(streamId, sessionId));
}

export async function deleteWorkyWhatsAppIntegration(streamId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.worky.whatsappIntegration(streamId));
}

export async function getWorkyWhatsAppSystemBotStatus(): Promise<{ connected: boolean }> {
  const response = await apiClient.get<ApiResponse<{ connected: boolean }>>(
    API_ENDPOINTS.worky.whatsappSystemBotStatus,
  );
  return unwrap(response);
}
