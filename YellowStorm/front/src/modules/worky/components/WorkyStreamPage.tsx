import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useModuleTranslation } from '@/modules/localization';
import { StreamSidebar } from './StreamSidebar';
import { StreamHeader } from './StreamHeader';
import { KanbanBoard } from './KanbanBoard';
import { PromptBar } from './PromptBar';
import { InteractionPanel } from './InteractionPanel';
import { PlanDeltaToast } from './PlanDeltaToast';
import { StreamControls } from './StreamControls';
import { ApprovalModal } from './ApprovalModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { BudgetControl } from './BudgetControl';
import { HumanTaskPanel } from './HumanTaskPanel';
import { MemoryProposalCard } from './MemoryProposalCard';
import { StreamModelsControl } from './StreamModelsControl';
import { workyKeys } from '../query/queryKeys';
import { subscribeToStreamEvents } from '../stream/sse';
import { useWorkyStore } from '../store';
import {
  useBoard,
  useMessages,
  useStream,
  useUpdateStream,
} from '../query/hooks';
import type { WorkyEvent, WorkyMessage, WorkyPendingClarification, WorkyTask } from '../types';

function summarizeDelta(event: WorkyEvent): string {
  const created = (event.data.createdTaskIds as string[] | undefined)?.length ?? 0;
  const updated = (event.data.updatedTaskIds as string[] | undefined)?.length ?? 0;
  const cancelled = (event.data.cancelledTaskIds as string[] | undefined)?.length ?? 0;
  const parts: string[] = [];
  if (created) parts.push(`+${created}`);
  if (updated) parts.push(`~${updated}`);
  if (cancelled) parts.push(`-${cancelled}`);
  return parts.length === 0 ? 'Plan updated' : parts.join(' / ');
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
  const appendAssistantToken = useWorkyStore((s) => s.appendAssistantToken);
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
            planDeltaRef: null,
            createdAt: new Date().toISOString(),
          };
          if (m.id) appendMessage(m);
          break;
        }
        case 'assistant_token': {
          setStreaming(true);
          const text = String((event.data as { text?: string }).text ?? '');
          if (text) appendAssistantToken(text);
          break;
        }
        case 'plan.delta.applied': {
          const summary = summarizeDelta({ type: 'plan.delta.applied', data: event.data });
          setLastDeltaToast({ summary, at: Date.now() });
          setLastPlanVersion(
            typeof (event.data as { resultPlanVersion?: number }).resultPlanVersion === 'number'
              ? ((event.data as { resultPlanVersion: number }).resultPlanVersion)
              : null,
          );
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          void qc.invalidateQueries({ queryKey: workyKeys.messages(streamId) });
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
          break;
        }
        case 'interaction.requested': {
          // Auto-open the approval modal for type=approval; clarifications
          // continue to render via the existing InteractionPanel.
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
          break;
        }
        case 'stream.terminal': {
          setStreaming(false);
          if (event.data && (event.data as { error?: boolean }).error) {
            // Prefer the runtime's own error text when the backend
            // forwarded it (the runtime's `planning.error` payload
            // is propagated as `errorText`); fall back to the
            // localized generic message.
            const detail = (event.data as { errorText?: string }).errorText;
            setStreamError(detail || tWorky('stream.error'));
          } else {
            setStreamError(null);
          }
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
    appendAssistantToken,
    qc,
    setLastDeltaToast,
    setLastPlanVersion,
    setStreaming,
    setStreamError,
    tWorky,
  ]);

  // When the user lands on a stream, mark `streaming=false` after
  // the SSE pipe opens (so the prompt bar's send button shows the
  // icon, not the stop icon). On `planning.done` events the runtime
  // sends `stream.terminal` with `error: false`.
  useEffect(() => {
    return () => {
      resetAssistantText();
      setStreaming(false);
    };
  }, [streamId, resetAssistantText, setStreaming]);

  // Render the assistant's streaming text in the prompt-bar area as
  // a small chip so the owner can see progress.
  const assistantText = useWorkyStore((s) => s.assistantText);
  const isStreaming = useWorkyStore((s) => s.streaming);
  const streamError = useWorkyStore((s) => s.streamError);
  const clearStreamError = useWorkyStore((s) => s.setStreamError);

  // Title rename via the existing stream mutation (Part 3 reuses
  // the Part 1 endpoint; PATCH /worky/streams/{id} is owner-only).
  const onRename = (newTitle: string) => {
    if (!newTitle.trim()) return;
    updateStream.mutate({ streamId, data: { title: newTitle.trim() } });
  };

  return (
    <div className='flex h-full w-full flex-col'>
      <div className='flex h-full w-full flex-1 overflow-hidden'>
        <StreamSidebar />
        <section className='flex h-full flex-1 flex-col overflow-hidden'>
          <StreamHeader streamId={streamId} onRename={onRename} />
          <InteractionPanel streamId={streamId} />
          <div className='grid flex-1 grid-cols-[1fr_320px] overflow-hidden'>
            <KanbanBoard onTaskClick={setSelectedTask} />
            <aside className='flex flex-col overflow-y-auto border-l border-border/60 bg-background/30 p-3 space-y-3'>
              {streamQuery.data ? (
                <StreamModelsControl stream={streamQuery.data} />
              ) : null}
              <BudgetControl streamId={streamId} />
              <HumanTaskPanel
                streamId={streamId}
                tasks={
                  boardQuery.data
                    ? Object.values(boardQuery.data.lanes).flat()
                    : []
                }
              />
              <MemoryProposalCard />
            </aside>
          </div>
        </section>
      </div>
      {isStreaming ? (
        <div className='border-t border-border/60 bg-background/40 px-6 py-2 text-xs italic text-muted-foreground'>
          {assistantText || tWorky('stream.working')}
        </div>
      ) : null}
      {streamError ? (
        <div
          role='alert'
          data-testid='worky-stream-error'
          className='flex items-start gap-3 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive'
        >
          <AlertTriangle className='mt-0.5 h-4 w-4 flex-none' />
          <div className='flex-1 break-words'>{streamError}</div>
          <button
            type='button'
            className='text-destructive/80 underline-offset-2 hover:underline'
            onClick={() => clearStreamError(null)}
          >
            {tWorky('stream.errorDismiss')}
          </button>
        </div>
      ) : null}
      {streamQuery.data ? (
        <StreamControls
          streamId={streamId}
          status={streamQuery.data.status}
          controlState={streamQuery.data.controlState}
        />
      ) : null}
      <PromptBar
        streamId={streamId}
        status={streamQuery.data?.status}
        managerModelId={streamQuery.data?.managerModelId}
        workerModelId={streamQuery.data?.workerModelId}
      />
      <PlanDeltaToast />
      {approvalFor ? (
        <ApprovalModal
          open
          streamId={streamId}
          interaction={approvalFor}
          onClose={() => setApprovalFor(null)}
        />
      ) : null}
      <TaskDetailDrawer
        streamId={streamId}
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

export function WorkyStreamPage(): JSX.Element {
  const params = useParams<{ streamId: string }>();
  const streamId = params.streamId ?? '';

  if (!streamId) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-muted-foreground'>
        Stream id is missing from the URL.
      </div>
    );
  }

  return <WorkyStreamBody streamId={streamId} />;
}
