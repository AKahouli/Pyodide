import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import type { HumanFeedbackData } from '../types';

const setDesignerOpenMock = vi.fn();
const setCopilotModeMock = vi.fn();
const selectStepMock = vi.fn();
const storeState = {
  setDesignerOpen: setDesignerOpenMock,
  setCopilotMode: setCopilotModeMock,
  selectStep: selectStepMock,
  designerOpen: false,
  copilotMode: 'design',
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (sel: any) => sel({
    ...storeState,
  }),
}));

const pendingApproval: HumanFeedbackData = {
  interruptType: 'approval_request',
  message: 'Approve this action?',
  status: 'pending',
  taskDescription: 'Run deploy',
  result: '',
};

const answeredApproval: HumanFeedbackData = {
  ...pendingApproval,
  status: 'answered',
  approved: true,
  humanResponse: 'approved',
};

const pendingClarification: HumanFeedbackData = {
  interruptType: 'clarification',
  message: 'What env?',
  status: 'pending',
  taskDescription: '',
  result: '',
};

describe('HumanFeedbackInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.designerOpen = false;
    storeState.copilotMode = 'design';
  });

  it('renders approval title and copilot prompt for pending approval', () => {
    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);
    expect(screen.getByText('interrupt.approvalTitle')).toBeInTheDocument();
    expect(screen.getByText('Approve this action?')).toBeInTheDocument();
    expect(screen.getByText('interrupt.answerInCopilot')).toBeInTheDocument();
    expect(screen.getByText('interrupt.waitingForDecision')).toBeInTheDocument();
    expect(screen.getByText('interrupt.openCopilot')).toBeInTheDocument();
  });

  it('renders approval title and message for pending approval', () => {
    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);
    expect(screen.getByText('interrupt.approvalTitle')).toBeInTheDocument();
    expect(screen.getByText('Approve this action?')).toBeInTheDocument();
  });

  it('renders answered state for non-pending data', () => {
    render(<HumanFeedbackInline data={answeredApproval} taskId="t1" />);
    expect(screen.getByText('interrupt.approved')).toBeInTheDocument();
    expect(screen.queryByText('interrupt.openCopilot')).not.toBeInTheDocument();
  });

  it('renders scope and memory metadata for answered feedback', () => {
    render(<HumanFeedbackInline data={{ ...answeredApproval, scope: 'future_workflow_runs', remember: true }} taskId="t1" />);
    expect(screen.getByText('interrupt.scope.future_workflow_runs')).toBeInTheDocument();
    expect(screen.getByText('interrupt.rememberFeedback')).toBeInTheDocument();
  });

  it('opens interrupt copilot for the current step', async () => {
    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);
    await userEvent.click(screen.getByText('interrupt.openCopilot'));
    expect(selectStepMock).toHaveBeenCalledWith('t1');
    expect(setCopilotModeMock).toHaveBeenCalledWith('interrupt');
    expect(setDesignerOpenMock).toHaveBeenCalledWith(true);
  });

  it('shows clarification title and copilot affordance for clarification type', () => {
    render(<HumanFeedbackInline data={pendingClarification} taskId="t1" />);
    expect(screen.getByText('interrupt.clarificationTitle')).toBeInTheDocument();
    expect(screen.getByText('interrupt.openCopilot')).toBeInTheDocument();
  });

  it('removes the open-copilot CTA when the interrupt panel is already open', () => {
    storeState.designerOpen = true;
    storeState.copilotMode = 'interrupt';

    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);

    expect(screen.getByText('interrupt.answerInCopilotOpen')).toBeInTheDocument();
    expect(screen.queryByText('interrupt.openCopilot')).not.toBeInTheDocument();
  });

  it('keeps clarification pending state read-only in the step detail', () => {
    render(<HumanFeedbackInline data={pendingClarification} taskId="t1" />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders pending interrupt scope and downstream metadata', () => {
    render(<HumanFeedbackInline data={{
      ...pendingClarification,
      feedbackScopeDefault: 'downstream_run',
      downstreamNodeIds: ['next-step'],
      memoryCandidate: true,
    }} taskId="t1" />);

    expect(screen.getByText('interrupt.scope.downstream_run')).toBeInTheDocument();
    expect(screen.getByText('interrupt.downstreamImpact')).toBeInTheDocument();
    expect(screen.getByText('interrupt.rememberFeedback')).toBeInTheDocument();
  });
});
