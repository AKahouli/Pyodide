import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterruptDialog } from './InterruptDialog';
import type { PlaybookExecution } from '../types';

const resumeExecutionMock = vi.fn();
let currentExecution: PlaybookExecution | null = null;

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'flow-1' }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => (
    <select aria-label="interrupt.scopeLabel" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, disabled, onCheckedChange }: { checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      aria-label="interrupt.rememberFeedback"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('../store', () => ({
  useCurrentExecution: () => currentExecution,
  usePlaybookStore: (selector: (state: { resumeExecution: typeof resumeExecutionMock }) => unknown) => selector({
    resumeExecution: resumeExecutionMock,
  }),
}));

function makeExecution(overrides: Partial<PlaybookExecution> = {}): PlaybookExecution {
  return {
    id: 'exec-1',
    playbookId: 'flow-1',
    status: 'interrupted',
    inputContext: {},
    taskResults: [],
    waitingForHumanInput: true,
    currentInterruptId: 'interrupt-1',
    currentInterruptTaskId: 'task-1',
    interruptPayload: {
      type: 'approval_request',
      taskId: 'task-1',
      taskTitle: 'Approve send',
      message: 'Approve external send?',
      threadId: 'thread-1',
      interruptId: 'interrupt-1',
      round: 0,
      payloadJson: '',
      resumableActions: [],
      taskDescription: '',
      result: '',
      riskLevel: 'critical',
    },
    hitlHistory: [],
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    ...overrides,
  } as PlaybookExecution;
}

describe('InterruptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentExecution = makeExecution();
  });

  it('passes selected feedback scope and memory consent when approving', async () => {
    render(<InterruptDialog open onOpenChange={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText('interrupt.scopeLabel'), 'future_workflow_runs');
    await userEvent.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await userEvent.click(screen.getByRole('button', { name: 'interrupt.approve' }));

    await waitFor(() => {
      expect(resumeExecutionMock).toHaveBeenCalledWith('flow-1', expect.objectContaining({
        executionId: 'exec-1',
        taskId: 'task-1',
        interruptId: 'interrupt-1',
        approved: true,
        scope: 'future_workflow_runs',
        remember: true,
      }));
    });
  });

  it('defaults critical approvals to step-only feedback without memory', async () => {
    render(<InterruptDialog open onOpenChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'interrupt.approve' }));

    await waitFor(() => {
      expect(resumeExecutionMock).toHaveBeenCalledWith('flow-1', expect.objectContaining({
        scope: 'step_only',
        remember: false,
      }));
    });
  });

  it('keeps fallback history scope selection across local re-renders', async () => {
    currentExecution = makeExecution({
      interruptPayload: null,
      hitlHistory: [{
        interruptId: 'interrupt-1',
        taskId: 'task-1',
        type: 'approval_request',
        taskTitle: 'Approve send',
        message: 'Approve external send?',
        taskDescription: '',
        result: '',
        round: 0,
        payloadJson: '',
        resumableActions: [],
        status: 'pending',
        responseAction: null,
        responseMessage: null,
        responseApproved: null,
        responseReason: null,
        responseFeedback: null,
        respondedBy: null,
        respondedAt: null,
        createdAt: '2026-05-31T00:00:00.000Z',
        riskLevel: 'critical',
      }],
    });
    render(<InterruptDialog open onOpenChange={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText('interrupt.scopeLabel'), 'future_workflow_runs');
    await userEvent.click(screen.getByLabelText('interrupt.rememberFeedback'));
    await userEvent.click(screen.getByRole('button', { name: 'interrupt.approve' }));

    await waitFor(() => {
      expect(resumeExecutionMock).toHaveBeenCalledWith('flow-1', expect.objectContaining({
        scope: 'future_workflow_runs',
        remember: true,
      }));
    });
  });
});
