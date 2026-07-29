import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyPendingClarification, WorkyTask } from '../../types';
import type { WorkyAgent } from '../../agents/agentModel';
import { AgentTeamView } from './AgentTeamView';
import { ManagerVoiceBanner } from './ManagerVoiceBanner';
import { WorkyMobileNav } from './WorkyMobileNav';
import { TaskDetailSheet } from './TaskDetailSheet';
import { BudgetSheet } from './BudgetSheet';
import { ApprovalSheet } from './ApprovalSheet';
import { ManagerChatSheet } from './ManagerChatSheet';
import { PlanDeltaToast } from '../PlanDeltaToast';

/**
 * Single-column mobile layout for a stream: manager voice banner, agent-team
 * body, bottom nav with the centered voice button, and bottom sheets for
 * task / budget / approval / chat. All SSE wiring lives in the parent
 * WorkyStreamBody and runs for this branch too.
 *
 * NOTE (flag): `onVoice`/`onTalk` open the chat sheet for now — Phase D swaps
 * them to the turn-based voice session. The "More" tab opens the budget sheet
 * as an interim entry point.
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
  const [selectedTask, setSelectedTask] = useState<WorkyTask | null>(null);

  const openAgent = (agent: WorkyAgent): void => {
    setSelectedTask(agent.currentTask);
    setActiveSheet('task');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <div className="mb-4">
          <ManagerVoiceBanner onTalk={() => setActiveSheet('chat')} />
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
          onVoice={() => setActiveSheet('chat')}
          onHome={() => navigate('/worky')}
        />
      </div>

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
      <PlanDeltaToast />
    </div>
  );
}
