import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyPendingClarification, WorkyTask } from '../../types';
import type { WorkyAgent } from '../../agents/agentModel';
import { AgentTeamView } from './AgentTeamView';
import { MobileStreamHeader } from './MobileStreamHeader';
import { ManagerVoiceBanner } from './ManagerVoiceBanner';
import { WorkyMobileNav } from './WorkyMobileNav';
import { TaskDetailSheet } from './TaskDetailSheet';
import { BudgetSheet } from './BudgetSheet';
import { ApprovalSheet } from './ApprovalSheet';
import { AgentTasksSheet } from './AgentTasksSheet';
import { ManagerChatSheet } from './ManagerChatSheet';
import { VoiceSession } from '../voice/VoiceSession';
import { PlanDeltaToast } from '../PlanDeltaToast';

/**
 * Single-column mobile layout for a stream: manager voice banner, agent-team
 * body, bottom nav with the centered voice button, and bottom sheets for
 * task / budget / approval / chat. All SSE wiring lives in the parent
 * WorkyStreamBody and runs for this branch too.
 *
 * The voice button + banner mic open the turn-based voice session; Keyboard
 * inside it falls back to the chat sheet. NOTE (flag): the "More" tab opens the
 * budget sheet as an interim entry point until a full "more" menu exists.
 */
export function WorkyMobileStream({
  streamId,
  approvalFor,
  onApprovalClose,
}: {
  streamId: string;
  approvalFor: WorkyPendingClarification | null;
  onApprovalClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const mobileTab = useWorkyUiStore((s) => s.mobileTab);
  const setMobileTab = useWorkyUiStore((s) => s.setMobileTab);
  const activeSheet = useWorkyUiStore((s) => s.activeSheet);
  const setActiveSheet = useWorkyUiStore((s) => s.setActiveSheet);
  const voiceOpen = useWorkyUiStore((s) => s.voiceOpen);
  const setVoiceOpen = useWorkyUiStore((s) => s.setVoiceOpen);
  const [selectedTask, setSelectedTask] = useState<WorkyTask | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<WorkyAgent | null>(null);

  const openAgent = (agent: WorkyAgent): void => {
    setSelectedAgent(agent);
    setActiveSheet('agent');
  };

  const openTask = (task: WorkyTask): void => {
    setSelectedTask(task);
    setActiveSheet('task');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MobileStreamHeader
        streamId={streamId}
        onBack={() => navigate('/worky')}
        onOpenChat={() => setActiveSheet('chat')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
        <div className="mb-4">
          <ManagerVoiceBanner onTalk={() => setVoiceOpen(true)} />
        </div>
        <AgentTeamView onOpenAgent={openAgent} />
      </div>

      <div className="shrink-0">
        <WorkyMobileNav
          active={mobileTab}
          onChange={(tab) => {
            setMobileTab(tab);
            if (tab === 'chat') setActiveSheet('chat');
            else if (tab === 'more') setActiveSheet('budget');
          }}
          onVoice={() => setVoiceOpen(true)}
          onHome={() => navigate('/worky')}
        />
      </div>

      <AgentTasksSheet
        agent={selectedAgent}
        open={activeSheet === 'agent'}
        onOpenChange={(o) => setActiveSheet(o ? 'agent' : null)}
        onOpenTask={openTask}
      />
      <TaskDetailSheet
        streamId={streamId}
        task={selectedTask}
        open={activeSheet === 'task'}
        onOpenChange={(o) => setActiveSheet(o ? 'task' : null)}
      />
      <BudgetSheet
        streamId={streamId}
        open={activeSheet === 'budget'}
        onOpenChange={(o) => setActiveSheet(o ? 'budget' : null)}
      />
      <ManagerChatSheet
        streamId={streamId}
        open={activeSheet === 'chat'}
        onOpenChange={(o) => setActiveSheet(o ? 'chat' : null)}
      />
      <ApprovalSheet
        streamId={streamId}
        interaction={approvalFor}
        open={Boolean(approvalFor)}
        onOpenChange={(o) => {
          if (!o) onApprovalClose();
        }}
      />
      <VoiceSession
        streamId={streamId}
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onKeyboard={() => setActiveSheet('chat')}
      />
      <PlanDeltaToast />
    </div>
  );
}
