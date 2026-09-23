import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useModuleTranslation } from '@/modules/localization';
import { StreamHeader } from './StreamHeader';
import { PlanDeltaToast } from './PlanDeltaToast';
import { ApprovalModal } from './ApprovalModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { FileViewerSidebar } from '@/modules/file-viewer';
import { workyKeys } from '../query/queryKeys';
import { subscribeToStreamEvents } from '../stream/sse';
import { useWorkyStore } from '../store';
import { useWorkyUiStore } from '../uiStore';
import {
  useBoard,
  useMessages,
  useStream,
  useUpdateStream,
} from '../query/hooks';
import { useIsMobile } from '@/hooks/use-mobile';
import { WorkyMobileStream } from './mobile/WorkyMobileStream';
import { WorkyVoiceDock } from './desktop/WorkyVoiceDock';
import { WorkyTopBar } from './desktop/WorkyTopBar';
import { WorkyActivityRail } from './desktop/WorkyActivityRail';
import { ManagerChatSheet } from './mobile/ManagerChatSheet';
import { useWorkyVoiceSession } from '../voice/useWorkyVoiceSession';
import { VoiceSettingsSheet } from './voice/VoiceSettingsSheet';
import { ConciergeInstructionsDialog } from './voice/ConciergeInstructionsDialog';
import type { WorkyBoardResponse, WorkyEvent, WorkyMessage, WorkyPendingClarification, WorkyTask } from '../types';
import { deriveExecutiveView } from '../executive/deriveExecutiveView';
import { WorkyExecutiveView } from './executive/WorkyExecutiveView';
import { WorkyGraphDialog } from './WorkyGraphDialog';
import { canOperateStream } from '../streamAccess';
import { findNewAttention, playAttentionChime } from '../attention';
import type { WorkyCurrentWorkStatus } from '../executive/executiveModel';

const EMPTY_BOARD: WorkyBoardResponse = {
  streamId: '',
  lanes: { backlog: [], ready: [], running: [], review: [], blocked: [], failed: [], done: [], canceled: [] },
  pendingClarifications: [],
};

function summarizeDelta(event: WorkyEvent, fallback: string): string {
  const created = (event.data.createdTaskIds as string[] | undefined)?.length ?? 0;
  const updated = (event.data.updatedTaskIds as string[] | undefined)?.length ?? 0;
  const cancelled = (event.data.cancelledTaskIds as string[] | undefined)?.length ?? 0;
  const parts: string[] = [];
  if (created) parts.push(`+${created}`);
  if (updated) parts.push(`~${updated}`);
  if (cancelled) parts.push(`-${cancelled}`);
  return parts.length === 0 ? fallback : parts.join(' / ');
}

function WorkyStreamBody({ streamId }: { streamId: string }): JSX.Element {
  const { t: tWorky } = useModuleTranslation('worky');
  const qc = useQueryClient();
  const setBoard = useWorkyStore((s) => s.setBoard);
  const setBoardLoading = useWorkyStore((s) => s.setBoardLoading);
  const setBoardError = useWorkyStore((s) => s.setBoardError);
  const setMessages = useWorkyStore((s) => s.setMessages);
  const setPendingClarifications = useWorkyStore((s) => s.setPendingClarifications);
  const appendMessage = useWorkyStore((s) => s.appendMessage);
  const resetAssistantText = useWorkyStore((s) => s.resetAssistantText);
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const setLastDeltaToast = useWorkyStore((s) => s.setLastDeltaToast);
  const setLastPlanVersion = useWorkyStore((s) => s.setLastPlanVersion);
  const setStreamError = useWorkyStore((s) => s.setStreamError);

  const boardQuery = useBoard(streamId);
  const messagesQuery = useMessages(streamId);
  const streamQuery = useStream(streamId);
  const updateStream = useUpdateStream();
  const [selectedTask, setSelectedTask] = useState<WorkyTask | null>(null);
  const [approvalFor, setApprovalFor] = useState<WorkyPendingClarification | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [attention, setAttention] = useState<{ taskId: string; sequence: number } | null>(null);
  const previousAttention = useRef<{ streamId: string; statuses: Map<string, WorkyCurrentWorkStatus> } | null>(null);
  const isMobile = useIsMobile();
  const pushActivity = useWorkyUiStore((s) => s.pushActivity);
  const clearActivity = useWorkyUiStore((s) => s.clearActivity);
  const activitySeq = useRef(0);

  useEffect(() => {
    setStreaming(false);
  }, [streamId, setStreaming]);

  useEffect(() => {
    setBoardLoading(boardQuery.isFetching);
    if (boardQuery.data) {
      setBoard(boardQuery.data);
      setPendingClarifications(boardQuery.data.pendingClarifications);
    }
    if (boardQuery.error) {
      setBoardError((boardQuery.error as Error).message);
    }
  }, [boardQuery.data, boardQuery.isFetching, boardQuery.error, setBoard, setBoardLoading, setBoardError, setPendingClarifications]);

  useEffect(() => {
    if (messagesQuery.data) {
      setMessages(messagesQuery.data);
    }
  }, [messagesQuery.data, setMessages]);

  useEffect(() => {
    const unsubscribe = subscribeToStreamEvents(streamId, (event) => {
      switch (event.type) {
        case 'message.appended': {
          const m: WorkyMessage = {
            id: String((event.data as { id?: string }).id ?? ''),
            role: ((event.data as { role?: string }).role ?? 'manager') as WorkyMessage['role'],
            content: String((event.data as { content?: string }).content ?? ''),
            turnId: typeof event.data.turnId === 'string' ? event.data.turnId : null,
            planDeltaRef: null,
            createdAt: new Date().toISOString(),
          };
          if (m.id) {
            appendMessage(m);
            // Also land it in the React Query cache. The messages effect
            // (setMessages) replaces the store list wholesale from this cache on
            // every refetch/setQueryData — e.g. the next useSendMessage.onSuccess.
            // Without this the SSE-only message lives only in the store and gets
            // wiped on the next send, even though it's already durable in Mongo.
            qc.setQueryData<WorkyMessage[]>(workyKeys.messages(streamId), (existing) => {
              if (!existing) return existing;
              if (existing.some((x) => x.id === m.id)) return existing;
              return [...existing, m];
            });
          }
          if (m.role === 'manager') resetAssistantText();
          break;
        }
        case 'plan.delta.applied': {
          const summary = summarizeDelta({ type: 'plan.delta.applied', data: event.data }, tWorky('plan.updated'));
          setLastDeltaToast({ summary, at: Date.now() });
          setLastPlanVersion(
            typeof (event.data as { resultPlanVersion?: number }).resultPlanVersion === 'number'
              ? ((event.data as { resultPlanVersion: number }).resultPlanVersion)
              : null,
          );
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.messages(streamId) });
          activitySeq.current += 1;
          pushActivity({ key: `a-${activitySeq.current}`, icon: 'git-branch', tone: 'primary', text: tWorky('activity.item.planUpdated') });
          break;
        }
        case 'plan.version.created': {
          setLastPlanVersion(
            typeof (event.data as { planVersion?: number }).planVersion === 'number'
              ? ((event.data as { planVersion: number }).planVersion)
              : null,
          );
          break;
        }
        case 'task.updated': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          break;
        }
        case 'task.completed': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
          activitySeq.current += 1;
          pushActivity({ key: `a-${activitySeq.current}`, icon: 'check', tone: 'working', text: tWorky('activity.item.taskCompleted') });
          break;
        }
        case 'interaction.requested': {
          const data = event.data as {
            type?: string;
            question?: string;
            options?: string[];
            interactionId?: string;
            taskId?: string | null;
            blocksTaskIds?: string[];
          };
          if (data.type === 'approval' && data.interactionId) {
            setApprovalFor({
              id: data.interactionId,
              type: 'approval',
              question: data.question ?? '',
              options: data.options ?? [],
              taskId: data.taskId ?? null,
              blocksTaskIds: data.blocksTaskIds ?? [],
            });
          }
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          activitySeq.current += 1;
          pushActivity({ key: `a-${activitySeq.current}`, icon: 'shield-alert', tone: 'blocked', text: tWorky('activity.item.approvalRequested') });
          break;
        }
        case 'interaction.responded': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          setApprovalFor((current) => (current ? null : current));
          break;
        }
        case 'stream.started':
        case 'stream.paused':
        case 'stream.resumed':
        case 'stream.stopped': {
          void qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          break;
        }
        case 'worker.spawned':
        case 'cost.recorded': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.budget(streamId) });
          if (event.type === 'worker.spawned') {
            activitySeq.current += 1;
            pushActivity({ key: `a-${activitySeq.current}`, icon: 'user-round', tone: 'done', text: tWorky('activity.item.agentSpawned') });
          }
          break;
        }
        case 'budget.updated':
        case 'budget.reserved':
        case 'budget.exhausted':
        case 'budget_decision.requested': {
          void qc.invalidateQueries({ queryKey: workyKeys.budget(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
          break;
        }
        case 'human_task.assigned':
        case 'human_task.feedback_submitted':
        case 'human_task.completed': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          break;
        }
        case 'report.generated': {
          void qc.invalidateQueries({ queryKey: workyKeys.report(streamId) });
          break;
        }
        case 'memory.proposed':
        case 'memory.confirmed':
        case 'memory.rejected': {
          void qc.invalidateQueries({ queryKey: ['worky', 'memory'] });
          break;
        }
        case 'replan.applied':
        case 'replan.required':
        case 'replan.approval_required': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
          break;
        }
        case 'stream.updated': {
          void qc.invalidateQueries({ queryKey: workyKeys.detail(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          break;
        }
        case 'stream.terminal': {
          const terminalTurnId =
            typeof event.data.turnId === 'string' ? event.data.turnId : null;
          const activeTurnId = useWorkyStore.getState().activeTurnId;
          if (activeTurnId && terminalTurnId !== activeTurnId) break;
          setStreaming(false);
          resetAssistantText();
          if (event.data && (event.data as { error?: boolean }).error) {
            const detail = (event.data as { errorText?: string }).errorText;
            setStreamError(detail || tWorky('stream.error'));
          } else {
            setStreamError(null);
          }
          break;
        }
        case 'message.component.appended': {
          // Manager message components arrived (Electric message_components) — refetch
          // the history so the bubble upgrades from plain content to rich components.
          void qc.invalidateQueries({ queryKey: workyKeys.messages(streamId) });
          break;
        }
        case 'task.component.appended':
        case 'task.artifact.appended': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          // Refetch whichever task drawer is open (keyed by Mongo taskId, which the
          // event's stepExternalId doesn't give us — invalidate the whole family).
          void qc.invalidateQueries({ queryKey: ['worky', 'task-result-content'] });
          break;
        }
        default:
          break;
      }
    });
    return unsubscribe;
  }, [
    streamId,
    appendMessage,
    qc,
    resetAssistantText,
    setLastDeltaToast,
    setLastPlanVersion,
    setStreaming,
    setStreamError,
    tWorky,
    pushActivity,
  ]);

  // Reset per-stream UI when switching streams: the activity feed and the task
  // detail drawer (its selectedTask is a stale task from the previous stream).
  useEffect(() => {
    clearActivity();
    setSelectedTask(null);
    setGraphOpen(false);
    setAttention(null);
  }, [streamId, clearActivity]);

  useEffect(() => {
    return () => {
      resetAssistantText();
      setStreaming(false);
    };
  }, [streamId, resetAssistantText, setStreaming]);

  const onRename = (newTitle: string) => {
    if (!newTitle.trim()) return;
    updateStream.mutate({ streamId, data: { title: newTitle.trim() } });
  };

  const orchestratorOpen = useWorkyUiStore((s) => s.orchestratorOpen);
  const setOrchestratorOpen = useWorkyUiStore((s) => s.setOrchestratorOpen);
  const voiceOpen = useWorkyUiStore((s) => s.voiceOpen);
  const setVoiceOpen = useWorkyUiStore((s) => s.setVoiceOpen);
  // Inline voice runs on the desktop dock; gate on !isMobile so the mobile sheet
  // (which runs its own session) doesn't double-instantiate. Must be called
  // before the isMobile early return below (Rules of Hooks).
  const canOperate = canOperateStream(streamQuery.isSuccess, streamQuery.data?.access);
  const readOnly = !canOperate;
  const voice = useWorkyVoiceSession(streamId, voiceOpen && !isMobile && canOperate);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const executiveModel = useMemo(() => deriveExecutiveView(boardQuery.data ?? EMPTY_BOARD, streamQuery.data?.status, messagesQuery.data ?? []), [boardQuery.data, streamQuery.data?.status, messagesQuery.data]);
  useEffect(() => {
    if (!boardQuery.data || boardQuery.data.streamId !== streamId) return;
    const previous = previousAttention.current?.streamId === streamId ? previousAttention.current.statuses : null;
    const { current, taskId } = findNewAttention(previous, executiveModel.currentWork);
    previousAttention.current = { streamId, statuses: current };
    if (taskId) {
      setAttention((currentAttention) => ({ taskId, sequence: (currentAttention?.sequence ?? 0) + 1 }));
      playAttentionChime();
    }
  }, [boardQuery.data, executiveModel.currentWork, streamId]);
  useEffect(() => {
    if (!canOperate && voiceOpen) setVoiceOpen(false);
  }, [canOperate, voiceOpen, setVoiceOpen]);
  // Close the slide-over automatically on stream switch so the next
  // stream doesn't inherit the open state of the previous one.
  useEffect(() => {
    setOrchestratorOpen(false);
  }, [streamId, setOrchestratorOpen]);

  if (isMobile) {
    return (
      <WorkyMobileStream
        streamId={streamId}
        approvalFor={readOnly ? null : approvalFor}
        onApprovalClose={() => setApprovalFor(null)}
        model={executiveModel}
        readOnly={readOnly}
        graphAvailable={Boolean(boardQuery.data)}
        attention={attention}
      />
    );
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <WorkyTopBar streamId={streamId} onOpenGraph={() => setGraphOpen(true)} graphAvailable={Boolean(boardQuery.data)} />
      {readOnly ? (
        <div className="border-b border-border bg-muted px-4 py-1 text-center text-xs text-muted-foreground">
          {tWorky('stream.readOnly')}
        </div>
      ) : null}
      <div className='flex min-h-0 flex-1 overflow-hidden'>
      <main
        data-testid='worky-stream-main'
        className='flex min-w-0 flex-1 flex-col overflow-hidden'
      >
        <StreamHeader streamId={streamId} onRename={readOnly ? undefined : onRename} />
        <div className='min-h-0 flex-1 overflow-y-auto bg-muted/20' data-testid='worky-executive-scroll'>
          <WorkyExecutiveView streamId={streamId} model={executiveModel} onTaskClick={setSelectedTask} onReviewApproval={() => setOrchestratorOpen(true)} readOnly={readOnly} attention={attention} focusAttention={!graphOpen} />
        </div>
      </main>
      {selectedTask ? (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
      {!readOnly ? <WorkyActivityRail
        streamId={streamId}
        model={executiveModel}
      /> : null}
      {/* Sidebar-mode file viewer host. Floating mode is mounted globally in
          App.tsx; sidebar mode needs a per-page host — without this, clicking
          "view" on a desktop artifact (sidebar display mode) rendered nothing. */}
      <FileViewerSidebar />
      </div>
      {!readOnly ? <ManagerChatSheet
        streamId={streamId}
        open={orchestratorOpen}
        onOpenChange={setOrchestratorOpen}
        sessionStatus={executiveModel.session?.status}
      /> : null}
      <PlanDeltaToast />
      {!readOnly && approvalFor ? (
        <ApprovalModal
          open
          streamId={streamId}
          interaction={approvalFor}
          onClose={() => setApprovalFor(null)}
        />
      ) : null}
      {!readOnly ? <WorkyVoiceDock
        state={voice.state}
        level={voice.level}
        muted={voice.muted}
        active={voiceOpen}
        onToggle={() => setVoiceOpen(!voiceOpen)}
        onMute={voice.toggleMute}
        onOpenSettings={() => setVoiceSettingsOpen(true)}
        onOpenPrompt={() => setPromptOpen(true)}
      /> : null}
      {!readOnly ? <VoiceSettingsSheet open={voiceSettingsOpen} onOpenChange={setVoiceSettingsOpen} level={voice.level} /> : null}
      {!readOnly ? <ConciergeInstructionsDialog streamId={streamId} open={promptOpen} onOpenChange={setPromptOpen} /> : null}
      {graphOpen && <WorkyGraphDialog onClose={() => setGraphOpen(false)} onTaskClick={setSelectedTask} attention={attention} />}
    </div>
  );
}

export function WorkyStreamPage(): JSX.Element {
  const { t: tWorky } = useModuleTranslation('worky');
  const params = useParams<{ streamId: string }>();
  const streamId = params.streamId ?? '';

  if (!streamId) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-muted-foreground'>
        {tWorky('stream.missingId')}
      </div>
    );
  }

  return <WorkyStreamBody streamId={streamId} />;
}
