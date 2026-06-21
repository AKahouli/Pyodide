import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';
import { workyKeys } from './queryKeys';
import type {
  CreateWorkyStreamData,
  SendWorkyMessageData,
  UpdateWorkyStreamData,
  WorkyExecutionReport,
  WorkyGovernancePolicy,
  WorkyMemoryEntry,
  WorkyMemoryProposal,
  WorkyStream,
  WorkyStreamQueryParams,
} from '../types';

export function useStreams(params: WorkyStreamQueryParams = {}) {
  return useQuery({
    queryKey: workyKeys.list(params),
    queryFn: () => api.getStreams(params),
  });
}

export function useStream(streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? workyKeys.detail(streamId) : ['worky', 'detail', 'noop'],
    queryFn: () => {
      if (!streamId) throw new Error('streamId is required');
      return api.getStream(streamId);
    },
    enabled: Boolean(streamId),
  });
}

export function useCreateStream() {
  const qc = useQueryClient();
  return useMutation<WorkyStream, Error, CreateWorkyStreamData>({
    mutationFn: (data) => api.createStream(data),
    onSuccess: (stream) => {
      qc.setQueryData<WorkyStream[]>(workyKeys.lists(), (existing) =>
        existing ? [stream, ...existing] : [stream],
      );
      qc.invalidateQueries({ queryKey: workyKeys.lists() });
    },
  });
}

export function useUpdateStream() {
  const qc = useQueryClient();
  return useMutation<WorkyStream, Error, { streamId: string; data: UpdateWorkyStreamData }>({
    mutationFn: ({ streamId, data }) => api.updateStream(streamId, data),
    onSuccess: (stream) => {
      qc.setQueryData(workyKeys.detail(stream.id), stream);
      qc.invalidateQueries({ queryKey: workyKeys.lists() });
    },
  });
}

export function useMessages(streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? workyKeys.messages(streamId) : ['worky', 'messages', 'noop'],
    queryFn: () => {
      if (!streamId) throw new Error('streamId is required');
      return api.getMessages(streamId);
    },
    enabled: Boolean(streamId),
  });
}

export function useBoard(streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? workyKeys.board(streamId) : ['worky', 'board', 'noop'],
    queryFn: () => {
      if (!streamId) throw new Error('streamId is required');
      return api.getBoard(streamId);
    },
    enabled: Boolean(streamId),
  });
}

export function useSendMessage(streamId: string) {
  const qc = useQueryClient();
  return useMutation<
    { id: string; content: string; createdAt: string; turnStarted: true },
    Error,
    SendWorkyMessageData
  >({
    mutationFn: (data: SendWorkyMessageData) => api.sendMessage(streamId, data),
    onSuccess: (msg) => {
      qc.setQueryData<Awaited<ReturnType<typeof api.getMessages>>>(
        workyKeys.messages(streamId),
        (existing) => (existing ? [...existing, { ...msg, role: 'owner', planDeltaRef: null }] : existing),
      );
    },
  });
}

export function useRespondInteraction(streamId: string) {
  const qc = useQueryClient();
  return useMutation<
    {
      interactionId: string;
      streamId: string;
      status: 'responded' | 'canceled';
      response: string;
      verdict: 'approved' | 'rejected' | null;
      followUpTurnStarted: boolean;
    },
    Error,
    { interactionId: string; content: string; cancel?: boolean; approve?: boolean }
  >({
    mutationFn: ({ interactionId, content, cancel, approve }) =>
      api.respondInteraction(interactionId, content, { cancel, approve }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
      qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
    },
  });
}

export function useStartStream() {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.startStream>>,
    Error,
    string
  >({
    mutationFn: (streamId) => api.startStream(streamId),
    onSuccess: (data, streamId) => {
      qc.setQueryData(workyKeys.detail(streamId), (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        return { ...(current as Record<string, unknown>), status: data.outcome === 'globally_blocked' ? 'start_validation_failed' : 'active' };
      });
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
    },
  });
}

export function usePauseStream() {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.pauseStream>>,
    Error,
    { streamId: string; reason?: string }
  >({
    mutationFn: ({ streamId, reason }) => api.pauseStream(streamId, reason),
    onSuccess: (_data, { streamId }) => {
      qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
    },
  });
}

export function useResumeStream() {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.resumeStream>>,
    Error,
    { streamId: string; reason?: string }
  >({
    mutationFn: ({ streamId, reason }) => api.resumeStream(streamId, reason),
    onSuccess: (_data, { streamId }) => {
      qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
    },
  });
}

export function useStopStream() {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.stopStream>>,
    Error,
    { streamId: string; reason?: string }
  >({
    mutationFn: ({ streamId, reason }) => api.stopStream(streamId, reason),
    onSuccess: (_data, { streamId }) => {
      qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
    },
  });
}

export function useDeleteStream() {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.deleteStream>>,
    Error,
    string
  >({
    mutationFn: (streamId) => api.deleteStream(streamId),
    onSuccess: (_data, streamId) => {
      qc.removeQueries({ queryKey: workyKeys.detail(streamId) });
      qc.invalidateQueries({ queryKey: workyKeys.lists() });
    },
  });
}

export function useTaskOps(streamId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
  };
  return {
    move: useMutation<
      Awaited<ReturnType<typeof api.moveTask>>,
      Error,
      { taskId: string; lane: string; reason?: string }
    >({
      mutationFn: ({ taskId, lane, reason }) => api.moveTask(taskId, lane, reason),
      onSuccess: invalidate,
    }),
    pause: useMutation<
      Awaited<ReturnType<typeof api.pauseTask>>,
      Error,
      { taskId: string; reason?: string }
    >({
      mutationFn: ({ taskId, reason }) => api.pauseTask(taskId, reason),
      onSuccess: invalidate,
    }),
    resume: useMutation<
      Awaited<ReturnType<typeof api.resumeTask>>,
      Error,
      { taskId: string; reason?: string }
    >({
      mutationFn: ({ taskId, reason }) => api.resumeTask(taskId, reason),
      onSuccess: invalidate,
    }),
    cancel: useMutation<
      Awaited<ReturnType<typeof api.cancelTask>>,
      Error,
      { taskId: string; reason?: string }
    >({
      mutationFn: ({ taskId, reason }) => api.cancelTask(taskId, reason),
      onSuccess: invalidate,
    }),
    review: useMutation<
      Awaited<ReturnType<typeof api.reviewTask>>,
      Error,
      { taskId: string; reason?: string }
    >({
      mutationFn: ({ taskId, reason }) => api.reviewTask(taskId, reason),
      onSuccess: invalidate,
    }),
  };
}

export function useTaskResults(taskId: string | null | undefined) {
  return useQuery({
    queryKey: taskId ? workyKeys.taskResults(taskId) : ['worky', 'task-results', 'noop'],
    queryFn: () => {
      if (!taskId) throw new Error('taskId is required');
      return api.getTaskResults(taskId);
    },
    enabled: Boolean(taskId),
  });
}

export function useGovernancePolicy(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceId ? workyKeys.governancePolicy(workspaceId) : ['worky', 'governance', 'noop'],
    queryFn: () => {
      if (!workspaceId) throw new Error('workspaceId is required');
      return api.getGovernancePolicy(workspaceId);
    },
    enabled: Boolean(workspaceId),
  });
}

export function useUpdateGovernancePolicy() {
  const qc = useQueryClient();
  return useMutation<WorkyGovernancePolicy, Error, WorkyGovernancePolicy>({
    mutationFn: (policy) => api.upsertGovernancePolicy(policy),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: workyKeys.governancePolicy(data.workspaceId) });
    },
  });
}

// =================================================================
// Part 4 — budget, reports, memory
// =================================================================

export function useStreamBudget(streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? workyKeys.budget(streamId) : ['worky', 'budget', 'noop'],
    queryFn: () => {
      if (!streamId) throw new Error('streamId is required');
      return api.getStreamBudget(streamId);
    },
    enabled: Boolean(streamId),
  });
}

export function useUpdateStreamBudget(streamId: string) {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.updateStreamBudget>>,
    Error,
    { limitUsd: number; limitTokens: number; enforcement: 'hard_stop' | 'notify' }
  >({
    mutationFn: (data) => api.updateStreamBudget(streamId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workyKeys.budget(streamId) });
    },
  });
}

export function useExecutionReport(streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? workyKeys.report(streamId) : ['worky', 'report', 'noop'],
    queryFn: () => {
      if (!streamId) throw new Error('streamId is required');
      return api.getExecutionReport(streamId);
    },
    enabled: Boolean(streamId),
  });
}

export function useGenerateExecutionReport(streamId: string) {
  const qc = useQueryClient();
  return useMutation<WorkyExecutionReport, Error, void>({
    mutationFn: () => api.generateExecutionReport(streamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workyKeys.report(streamId) });
    },
  });
}

export function useHumanUpdateTask(streamId: string) {
  const qc = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof api.humanUpdateTask>>,
    Error,
    { taskId: string; kind: 'in_progress' | 'feedback' | 'request_changes' | 'blocked' | 'done'; comment?: string }
  >({
    mutationFn: ({ taskId, kind, comment }) => api.humanUpdateTask(taskId, kind, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
    },
  });
}

export function useMemoryProposals(status?: 'pending' | 'confirmed' | 'rejected') {
  return useQuery({
    queryKey: workyKeys.memoryProposals(status),
    queryFn: () => api.listMemoryProposals(status),
  });
}

export function useMemoryEntries() {
  return useQuery({
    queryKey: workyKeys.memoryEntries(),
    queryFn: () => api.listMemoryEntries(),
  });
}

export function useConfirmMemoryProposal() {
  const qc = useQueryClient();
  return useMutation<WorkyMemoryEntry, Error, string>({
    mutationFn: (id) => api.confirmMemoryProposal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worky', 'memory'] });
    },
  });
}

export function useRejectMemoryProposal() {
  const qc = useQueryClient();
  return useMutation<WorkyMemoryProposal, Error, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => api.rejectMemoryProposal(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worky', 'memory'] });
    },
  });
}
