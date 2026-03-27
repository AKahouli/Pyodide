import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import type { HumanFeedbackData } from '../types';

const resumeMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'p1' }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/api-error', () => ({
  handleApiError: vi.fn(),
}));

vi.mock('../store', () => ({
  useCurrentExecution: () => ({ id: 'e1', playbookId: 'p1' }),
  usePlaybookStore: (sel: any) => sel({ resumeExecution: resumeMock }),
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
  it('renders approval title and message for pending approval', () => {
    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);
    expect(screen.getByText('interrupt.approvalTitle')).toBeInTheDocument();
    expect(screen.getByText('Approve this action?')).toBeInTheDocument();
    expect(screen.getByText('interrupt.approve')).toBeInTheDocument();
    expect(screen.getByText('interrupt.reject')).toBeInTheDocument();
  });

  it('renders answered state for non-pending data', () => {
    render(<HumanFeedbackInline data={answeredApproval} taskId="t1" />);
    expect(screen.getByText('interrupt.approved')).toBeInTheDocument();
    expect(screen.queryByText('interrupt.approve')).not.toBeInTheDocument();
  });

  it('calls resumeExecution on approve click', async () => {
    resumeMock.mockResolvedValueOnce(undefined);
    render(<HumanFeedbackInline data={pendingApproval} taskId="t1" />);
    await userEvent.click(screen.getByText('interrupt.approve'));
    expect(resumeMock).toHaveBeenCalledWith('p1', expect.objectContaining({
      executionId: 'e1',
      taskId: 't1',
      approved: true,
    }));
  });

  it('shows clarification title and submit button for clarification type', () => {
    render(<HumanFeedbackInline data={pendingClarification} taskId="t1" />);
    expect(screen.getByText('interrupt.clarificationTitle')).toBeInTheDocument();
    expect(screen.getByText('interrupt.submit')).toBeInTheDocument();
  });

  it('disables clarification submit when textarea is empty', () => {
    render(<HumanFeedbackInline data={pendingClarification} taskId="t1" />);
    const submitBtn = screen.getByText('interrupt.submit').closest('button');
    expect(submitBtn).toBeDisabled();
  });
});
