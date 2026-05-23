import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReplayBaselineSettingsDialog } from './ReplayBaselineSettingsDialog';
import type { PlaybookTask, ValidatedTaskReplay } from '../types';

const fetchTaskReplays = vi.fn();
const updateTaskReplayFormatGuide = vi.fn();
const renameTaskReplay = vi.fn();
const deleteTaskReplay = vi.fn();

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      fetchTaskReplays,
      updateTaskReplayFormatGuide,
      renameTaskReplay,
      deleteTaskReplay,
    }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} {...props} />
  ),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Loader2: () => null,
    Trash2: () => null,
  };
});

const task: PlaybookTask = {
  id: 'task-1',
  title: 'Task',
  description: '',
  assignedAgentId: null,
  executionMode: 'agent',
  selectedAction: 'index',
  executionOrder: 0,
  positionX: 0,
  positionY: 0,
  interruptBefore: false,
  interruptAfter: false,
  allowClarification: false,
  clarificationPrompt: '',
  maxClarifications: 0,
  inputKeys: [],
  outputKey: '',
  enabled: true,
  notifyOnComplete: false,
  notifyEmails: [],
  inputFiles: [],
  taskType: 'generic',
  inputPorts: [],
  outputPorts: [],
  hasValidatedReplay: true,
  hasOutputFormatTemplate: true,
  activeOutputFormatStatus: 'ready',
};

const replay: ValidatedTaskReplay = {
  id: 'replay-1',
  playbookId: 'playbook-1',
  taskId: 'task-1',
  taskTitle: 'Task',
  agentName: 'Agent',
  createdBy: 'user',
  referenceExecutionId: 'exec-1',
  referenceExecutionNumber: 2,
  validationVersion: 3,
  status: 'active',
  mode: 'strict_replay',
  toolCalls: [],
  referenceOutput: 'Reference output',
  preserveOutputFormat: true,
  outputFormatGuide: 'Current guide',
  formatGuideStatus: 'ready',
  replayConfig: {
    replayOutputFormat: true,
    replayToolTrace: false,
    replayReasoningChain: true,
  },
  label: 'Baseline Alpha',
  createdAt: '2026-05-23T10:00:00.000Z',
  updatedAt: '2026-05-23T10:00:00.000Z',
};

describe('ReplayBaselineSettingsDialog', () => {
  it('saves rename and replay settings together', async () => {
    fetchTaskReplays.mockResolvedValue([replay]);
    renameTaskReplay.mockResolvedValue({ ...replay, label: 'Renamed Baseline' });
    updateTaskReplayFormatGuide.mockResolvedValue({
      ...replay,
      label: 'Renamed Baseline',
      replayConfig: { ...replay.replayConfig, replayToolTrace: true },
    });

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replay}
        replayId={replay.id}
      />,
    );

    fireEvent.change(await screen.findByLabelText('baselineBadge.nameLabel'), { target: { value: 'Renamed Baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'baselineBadge.saveSettings' }));

    await waitFor(() => {
      expect(renameTaskReplay).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', 'Renamed Baseline');
      expect(updateTaskReplayFormatGuide).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', expect.objectContaining({
        outputFormatGuide: 'Current guide',
        replayConfig: expect.objectContaining({ replayToolTrace: false }),
      }));
    });
  });

  it('opens the output format editor when replay output format is enabled', async () => {
    fetchTaskReplays.mockResolvedValue([replay]);
    const onOpenOutputFormatEditor = vi.fn();

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replay}
        replayId={replay.id}
        onOpenOutputFormatEditor={onOpenOutputFormatEditor}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'baselineBadge.editOutputFormatTemplate' }));

    await waitFor(() => {
      expect(onOpenOutputFormatEditor).toHaveBeenCalledWith('task-1');
    });
  });

  it('removes the replay baseline', async () => {
    fetchTaskReplays.mockResolvedValue([replay]);
    deleteTaskReplay.mockResolvedValue({ removed: true, wasActive: true });
    const onReplayRemoved = vi.fn();

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replay}
        replayId={replay.id}
        onReplayRemoved={onReplayRemoved}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'baselineBadge.remove' }));

    await waitFor(() => {
      expect(deleteTaskReplay).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1');
      expect(onReplayRemoved).toHaveBeenCalledWith('replay-1');
    });
  });
});
