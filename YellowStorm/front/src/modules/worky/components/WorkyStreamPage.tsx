import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { StreamSidebar } from './StreamSidebar';
import { StreamHeader } from './StreamHeader';
import { KanbanBoard } from './KanbanBoard';
import { OrchestratorPanel } from './OrchestratorPanel';
import { PlanDeltaToast } from './PlanDeltaToast';
import { StreamControls } from './StreamControls';
import { ApprovalModal } from './ApprovalModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
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
import type { WorkyEvent, WorkyMessage, WorkyPendingClarification, WorkyTask } from '../types';

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
          if (m.role === 'manager') resetAssistantText();
          break;
        }
        case 'assistant_token': {
          setStreaming(true);
          const text = String((event.data as { text?: string }).text ?? '');
          if (text) appendAssistantToken(text);
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
          resetAssistantText();
          if (event.data && (event.data as { error?: boolean }).error) {
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
    resetAssistantText,
    setLastDeltaToast,
    setLastPlanVersion,
    setStreaming,
    setStreamError,
    tWorky,
  ]);

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
  // Close the slide-over automatically on stream switch so the next
  // stream doesn't inherit the open state of the previous one.
  useEffect(() => {
    setOrchestratorOpen(false);
  }, [streamId, setOrchestratorOpen]);

  return (
    <div className='flex h-full w-full overflow-hidden'>
      <StreamSidebar />
      <main
        data-testid='worky-stream-main'
        className='flex min-w-0 flex-1 flex-col overflow-hidden'
      >
        <StreamHeader streamId={streamId} onRename={onRename} />
        {streamQuery.data ? (
          <div className='flex items-center gap-2 border-b border-border/60 bg-background/20 px-6 py-2'>
            <div className='flex-1'>
              <StreamControls
                streamId={streamId}
                status={streamQuery.data.status}
                controlState={streamQuery.data.controlState}
              />
            </div>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setOrchestratorOpen(true)}
              className='lg:hidden'
              data-testid='worky-orchestrator-open'
              aria-label={tWorky('orchestrator.open')}
            >
              <Bot className='mr-1 h-3.5 w-3.5' />
              {tWorky('orchestrator.open')}
            </Button>
          </div>
        ) : null}
        <KanbanBoard streamId={streamId} onTaskClick={setSelectedTask} />
      </main>
      <OrchestratorPanel streamId={streamId} />
      {orchestratorOpen ? (
        <button
          type='button'
          aria-label={tWorky('orchestrator.close')}
          onClick={() => setOrchestratorOpen(false)}
          className='fixed inset-0 z-20 bg-black/40 backdrop-blur-sm lg:hidden'
          data-testid='worky-orchestrator-backdrop'
        />
      ) : null}
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
