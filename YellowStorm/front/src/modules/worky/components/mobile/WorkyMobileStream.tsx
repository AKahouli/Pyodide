import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyPendingClarification, WorkyTask } from '../../types';
import { MobileStreamHeader } from './MobileStreamHeader';
import { WorkyMobileNav } from './WorkyMobileNav';
import { TaskDetailSheet } from './TaskDetailSheet';
import { ApprovalSheet } from './ApprovalSheet';
import { ManagerChatSheet } from './ManagerChatSheet';
import { VoiceSession } from '../voice/VoiceSession';
import { PlanDeltaToast } from '../PlanDeltaToast';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import { WorkyExecutiveView } from '../executive/WorkyExecutiveView';

/**
 * Single-column mobile layout for a stream: agent-team body, bottom nav with
 * the centered voice button, and bottom sheets for task / approval / chat. All
 * SSE wiring lives in the parent WorkyStreamBody and runs for this branch too.
 *
 * The nav's centre button opens the turn-based voice session; Keyboard inside
 * it falls back to the chat sheet.
 */
export function WorkyMobileStream({
  streamId,
  approvalFor,
  onApprovalClose,
  model,
  readOnly = false,
}: {
  streamId: string;
  approvalFor: WorkyPendingClarification | null;
  onApprovalClose: () => void;
  model: WorkyExecutiveViewModel;
  readOnly?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const activeSheet = useWorkyUiStore((s) => s.activeSheet);
  const setActiveSheet = useWorkyUiStore((s) => s.setActiveSheet);
  const voiceOpen = useWorkyUiStore((s) => s.voiceOpen);
  const setVoiceOpen = useWorkyUiStore((s) => s.setVoiceOpen);
  const [selectedTask, setSelectedTask] = useState<WorkyTask | null>(null);

  const openTask = (task: WorkyTask): void => {
    setSelectedTask(task);
    setActiveSheet('task');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MobileStreamHeader
        streamId={streamId}
        onBack={() => navigate('/worky')}
      />
      {/* pb keeps the last agent card clear of the nav's raised voice button. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-8">
        <WorkyExecutiveView streamId={streamId} model={model} onTaskClick={openTask} readOnly={readOnly} />
      </div>

      <div className="shrink-0">
        <WorkyMobileNav
          onHome={() => navigate('/worky')}
          onVoice={() => setVoiceOpen(true)}
          onChat={() => setActiveSheet('chat')}
          canOperate={!readOnly}
        />
      </div>

      <TaskDetailSheet
        task={selectedTask}
        open={activeSheet === 'task'}
        onOpenChange={(o) => setActiveSheet(o ? 'task' : null)}
      />
      {!readOnly ? <ManagerChatSheet
        streamId={streamId}
        open={activeSheet === 'chat'}
        onOpenChange={(o) => setActiveSheet(o ? 'chat' : null)}
        sessionStatus={model.session?.status}
      /> : null}
      {!readOnly ? <ApprovalSheet
        streamId={streamId}
        interaction={approvalFor}
        open={Boolean(approvalFor)}
        onOpenChange={(o) => {
          if (!o) onApprovalClose();
        }}
      /> : null}
      {!readOnly ? <VoiceSession
        streamId={streamId}
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onKeyboard={() => setActiveSheet('chat')}
      /> : null}
      <PlanDeltaToast />
    </div>
  );
}
