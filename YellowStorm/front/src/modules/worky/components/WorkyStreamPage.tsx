import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { StreamHeader } from './StreamHeader';
import { KanbanBoard } from './KanbanBoard';
import { WorkyGraphBoard } from './WorkyGraphBoard';
import { PlanDeltaToast } from './PlanDeltaToast';
import { ApprovalModal } from './ApprovalModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { FileViewerSidebar } from '@/modules/file-viewer';
import { WorkyWhatsAppConnectModal } from './WorkyWhatsAppConnectModal';
import { workyKeys } from '../query/queryKeys';
import { subscribeToStreamEvents } from '../stream/sse';
import { useWorkyStore } from '../store';
import { useWorkyUiStore } from '../uiStore';
import {
  useBoard,
  useMessages,
  useStream,
  useUpdateStream,
  useWorkyWhatsAppIntegration,
} from '../query/hooks';
import { isWhatsAppConnected } from '@/lib/whatsapp-integration-utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { WorkyMobileStream } from './mobile/WorkyMobileStream';
import { AgentTeamView } from './mobile/AgentTeamView';
import { useStreamAgents } from '../agents/useStreamAgents';
import { WorkyVoiceDock } from './desktop/WorkyVoiceDock';
import { WorkyTopBar } from './desktop/WorkyTopBar';
import { WorkyActivityRail } from './desktop/WorkyActivityRail';
import { ManagerChatSheet } from './mobile/ManagerChatSheet';
import { useWorkyVoiceSession } from '../voice/useWorkyVoiceSession';
import { VoiceSettingsSheet } from './voice/VoiceSettingsSheet';
import { ConciergeInstructionsDialog } from './voice/ConciergeInstructionsDialog';
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
  const [boardView, setBoardView] = useState<'agents' | 'status' | 'graph'>('agents');
  const [approvalFor, setApprovalFor] = useState<WorkyPendingClarification | null>(null);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const whatsappQuery = useWorkyWhatsAppIntegration(streamId);
  const isMobile = useIsMobile();
  const { agents: streamAgents } = useStreamAgents();
  const pushActivity = useWorkyUiStore((s) => s.pushActivity);
  const clearActivity = useWorkyUiStore((s) => s.clearActivity);
  const activitySeq = useRef(0);

  useEffect(() => {
    setWhatsappModalOpen(false);
  }, [streamId]);

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

  // Reset the in-session activity feed when switching streams.
  useEffect(() => {
    clearActivity();
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
  const voice = useWorkyVoiceSession(streamId, voiceOpen && !isMobile);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  // Close the slide-over automatically on stream switch so the next
  // stream doesn't inherit the open state of the previous one.
  useEffect(() => {
    setOrchestratorOpen(false);
  }, [streamId, setOrchestratorOpen]);

  if (isMobile) {
    return (
      <WorkyMobileStream
        streamId={streamId}
        approvalFor={approvalFor}
        onApprovalClose={() => setApprovalFor(null)}
      />
    );
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <WorkyTopBar streamId={streamId} />
      <div className='flex min-h-0 flex-1 overflow-hidden'>
      <main
        data-testid='worky-stream-main'
        className='flex min-w-0 flex-1 flex-col overflow-hidden'
      >
        <StreamHeader streamId={streamId} onRename={onRename} />
        {streamQuery.data ? (
          <div className='flex items-center justify-end gap-2 border-b border-border/60 bg-background/20 px-6 py-2'>
            <div
              role='tablist'
              aria-label={tWorky('kanban.view.status')}
              className='grid shrink-0 grid-cols-3 rounded-md border border-border/60 bg-muted/20 p-0.5 text-xs'
              data-testid='worky-board-view-toggle'
            >
              {(['agents', 'status', 'graph'] as const).map((view) => (
                <button
                  key={view}
                  type='button'
                  role='tab'
                  aria-selected={boardView === view}
                  data-testid={`worky-board-view-${view}`}
                  onClick={() => setBoardView(view)}
                  className={cn(
                    'rounded px-2 py-1 font-medium transition-colors',
                    boardView === view
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tWorky(`kanban.view.${view}`)}
                </button>
              ))}
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
        {boardView === 'graph' ? (
          <WorkyGraphBoard onTaskClick={setSelectedTask} />
        ) : boardView === 'agents' ? (
          // pb clears the fixed WorkyVoiceDock, which would otherwise cover the
          // last row of agent cards at the bottom of the scroll.
          <div className='min-h-0 flex-1 overflow-y-auto p-6 pb-28' data-testid='worky-agents-scroll'>
            <div className='mx-auto flex max-w-5xl flex-col gap-4'>
              <h2 className='text-lg font-bold text-foreground'>
                {tWorky('agents.team.title')} · {tWorky('agents.team.count', { count: streamAgents.length })}
              </h2>
              <AgentTeamView onOpenTask={setSelectedTask} showHeader={false} columns={2} />
            </div>
          </div>
        ) : (
          <KanbanBoard streamId={streamId} onTaskClick={setSelectedTask} />
        )}
      </main>
      {selectedTask ? (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
      <WorkyActivityRail
        streamId={streamId}
        onWhatsAppClick={() => setWhatsappModalOpen(true)}
        whatsappConnected={isWhatsAppConnected(whatsappQuery.data?.status)}
      />
      {/* Sidebar-mode file viewer host. Floating mode is mounted globally in
          App.tsx; sidebar mode needs a per-page host — without this, clicking
          "view" on a desktop artifact (sidebar display mode) rendered nothing. */}
      <FileViewerSidebar />
      </div>
      <ManagerChatSheet
        streamId={streamId}
        open={orchestratorOpen}
        onOpenChange={setOrchestratorOpen}
        onWhatsAppClick={() => setWhatsappModalOpen(true)}
        whatsappConnected={isWhatsAppConnected(whatsappQuery.data?.status)}
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
      {whatsappModalOpen ? (
        <WorkyWhatsAppConnectModal
          open
          streamId={streamId}
          onClose={() => setWhatsappModalOpen(false)}
        />
      ) : null}
      <WorkyVoiceDock
        state={voice.state}
        level={voice.level}
        muted={voice.muted}
        active={voiceOpen}
        onToggle={() => setVoiceOpen(!voiceOpen)}
        onMute={voice.toggleMute}
        onOpenSettings={() => setVoiceSettingsOpen(true)}
        onOpenPrompt={() => setPromptOpen(true)}
      />
      <VoiceSettingsSheet open={voiceSettingsOpen} onOpenChange={setVoiceSettingsOpen} level={voice.level} />
      <ConciergeInstructionsDialog streamId={streamId} open={promptOpen} onOpenChange={setPromptOpen} />
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
