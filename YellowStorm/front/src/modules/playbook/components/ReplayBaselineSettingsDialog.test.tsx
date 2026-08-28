import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayBaselineSettingsDialog } from './ReplayBaselineSettingsDialog';
import type { PlaybookTask, ValidatedTaskReplay } from '../types';

const fetchTaskReplays = vi.fn();
const updateTaskReplayFormatGuide = vi.fn();
const renameTaskReplay = vi.fn();
const deleteTaskReplay = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
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
  Dialog: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
    <div>
      {children}
      <button type="button" aria-label="test-dialog-close" onClick={() => onOpenChange?.(false)} />
    </div>
  ),
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react');

  const TabsContext = React.createContext<{ value: string; setValue: (value: string) => void } | null>(null);

  return {
    Tabs: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange?: (value: string) => void }) => (
      <TabsContext.Provider value={{ value, setValue: onValueChange ?? (() => undefined) }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => {
      const context = React.useContext(TabsContext);
      return (
        <button
          type="button"
          data-state={context?.value === value ? 'active' : 'inactive'}
          onClick={() => context?.setValue(value)}
          {...props}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(TabsContext);
      if (context?.value !== value) return null;
      return <div>{children}</div>;
    },
  };
});

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} {...props} />
  ),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
    return {
      ...actual,
      ChevronDown: () => null,
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
  toolCalls: [{ callIndex: 1, toolName: 'search_docs', args: { query: 'replay' }, outputSummary: '1 result' }],
  referenceOutput: 'Reference output',
  preserveOutputFormat: true,
  outputFormatGuide: 'Current guide',
  formatGuideStatus: 'ready',
  llmPromptTrace: [{ stage: 'planner', model: 'gpt-5.4', prompt: 'Plan the replay run.' }],
  reasoningChain: [{ id: 'reason-1', type: 'decision', label: 'Pick route', description: 'Choose the validated path.', confidence: 0.91 }],
  intentKey: 'review-customer-sla',
  intentLabel: 'Review customer SLA',
  reasoningOutline: [{ stageKey: 'analyze', stageType: 'analysis', label: 'Analyze', description: 'Inspect the request.', confidence: 0.91 }],
  stableReasoningRules: ['Preserve analyze.'],
  contextVariableSchema: [{ key: 'query', label: 'Query', source: 'input_context', valueType: 'string', required: true, exampleValue: 'replay' }],
  toolTraceTemplate: [{ stepIndex: 1, toolName: 'search_docs', purpose: 'Find prior baseline evidence.', argumentShape: { query: 'string' }, required: true }],
  driftPolicy: { requireSameIntent: true, requireSameReasoningStages: true, requireSameToolOrder: true, allowAdditionalTools: false, allowArgumentValueChanges: true, enforceOutputContract: true },
  acceptedExamples: [{ referenceExecutionId: 'exec-1', referenceExecutionNumber: 2, summary: 'Validated replay baseline for Review customer SLA.', outputPreview: 'Reference output' }],
  referenceUsage: { totalTokens: 321, model: 'gpt-5.4' },
  referenceTaskDescription: 'Reproduce the prior validated execution.',
  referenceNodeSnapshot: { taskId: 'task-1', title: 'Task' },
  fingerprints: { inputContextHash: 'hash-1', nodeSnapshotHash: 'hash-2' },
  traceMetadata: { collected: true },
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
  it('uses the provided replay snapshot while refreshing by replay id', async () => {
    fetchTaskReplays.mockResolvedValue([replay]);

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replay}
        replayId={replay.id}
        defaultTab="overview"
      />,
    );

    expect(screen.queryByText('baselineBadge.loading')).not.toBeInTheDocument();
    expect(screen.getByText('baselineBadge.overview.ready')).toBeInTheDocument();
    await waitFor(() => expect(fetchTaskReplays).toHaveBeenCalledWith('playbook-1', 'task-1'));
  });

  it('shows captured replay validation data by default when requested', async () => {
    fetchTaskReplays.mockResolvedValue([replay]);

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replay}
        replayId={replay.id}
        defaultTab="technical"
      />,
    );

    expect(await screen.findByText('baselineBadge.technicalWarning')).toBeInTheDocument();
    expect(screen.queryByLabelText('baselineBadge.nameLabel')).not.toBeInTheDocument();
    expect(screen.getByText('baselineBadge.sections.replayTemplate')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.template.intentKey')).toBeInTheDocument();
    expect(screen.getByText('review-customer-sla')).toBeInTheDocument();
    expect(screen.getByText('Analyze')).toBeInTheDocument();
    expect(screen.getByText('Preserve analyze.')).toBeInTheDocument();
    expect(screen.getAllByText('search_docs')).toHaveLength(2);
    expect(screen.getByText('Plan the replay run.')).toBeInTheDocument();
    expect(screen.getByText('Pick route')).toBeInTheDocument();
    expect(screen.getAllByText('Reference output')).toHaveLength(2);
    expect(screen.getByText(/inputContextHash/)).toBeInTheDocument();
    expect(screen.getByText(/nodeSnapshotHash/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'baselineBadge.tabs.rules' }));
    expect(screen.getByLabelText('baselineBadge.nameLabel')).toBeInTheDocument();
    expect(screen.queryByText('baselineBadge.technicalWarning')).not.toBeInTheDocument();
  });

  it('shows explicit empty capture states when no replay artifacts were captured', async () => {
    const emptyReplay: ValidatedTaskReplay = {
      ...replay,
      toolCalls: [],
      llmPromptTrace: [],
      reasoningChain: [],
      intentKey: null,
      intentLabel: null,
      reasoningOutline: [],
      stableReasoningRules: [],
      contextVariableSchema: [],
      toolTraceTemplate: [],
      driftPolicy: null,
      acceptedExamples: [],
      referenceOutput: null,
      referenceNodeSnapshot: null,
      fingerprints: null,
      traceMetadata: {},
    };
    fetchTaskReplays.mockResolvedValue([emptyReplay]);

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={emptyReplay}
        replayId={emptyReplay.id}
        defaultTab="technical"
      />,
    );

    expect(await screen.findByText('baselineBadge.empty.output')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.replayTemplate')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.toolCalls')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.reasoning')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.prompts')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.nodeSnapshot')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.fingerprints')).toBeInTheDocument();
    expect(screen.getByText('baselineBadge.empty.traceMetadata')).toBeInTheDocument();
  });

  it('saves a rename without rewriting unchanged replay settings', async () => {
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
    });
    expect(updateTaskReplayFormatGuide).not.toHaveBeenCalled();
  });

  it('does not coerce a missing format guide to an empty string during rename-only saves', async () => {
    const replayWithoutGuide: ValidatedTaskReplay = {
      ...replay,
      outputFormatGuide: null,
    };
    fetchTaskReplays.mockResolvedValue([replayWithoutGuide]);
    renameTaskReplay.mockResolvedValue({ ...replayWithoutGuide, label: 'Renamed Baseline' });
    updateTaskReplayFormatGuide.mockResolvedValue({
      ...replayWithoutGuide,
      label: 'Renamed Baseline',
    });

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replayWithoutGuide}
        replayId={replayWithoutGuide.id}
      />,
    );

    fireEvent.change(await screen.findByLabelText('baselineBadge.nameLabel'), { target: { value: 'Renamed Baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'baselineBadge.saveSettings' }));

    await waitFor(() => {
      expect(renameTaskReplay).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', 'Renamed Baseline');
    });
    expect(updateTaskReplayFormatGuide).not.toHaveBeenCalled();
  });

  it('does not create replay settings when an untouched replay without configuration closes', async () => {
    const replayWithoutConfig: ValidatedTaskReplay = {
      ...replay,
      replayConfig: undefined,
    };
    fetchTaskReplays.mockResolvedValue([replayWithoutConfig]);
    const onOpenChange = vi.fn();

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={onOpenChange}
        playbookId="playbook-1"
        task={task}
        replay={replayWithoutConfig}
        replayId={replayWithoutConfig.id}
      />,
    );

    await screen.findByLabelText('baselineBadge.nameLabel');
    fireEvent.click(screen.getByRole('button', { name: 'test-dialog-close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateTaskReplayFormatGuide).not.toHaveBeenCalled();
    expect(renameTaskReplay).not.toHaveBeenCalled();
  });

  it('keeps rule editing disabled until replay refresh completes, then saves one user change', async () => {
    let resolveFetch: (replays: ValidatedTaskReplay[]) => void = () => undefined;
    fetchTaskReplays.mockReturnValue(new Promise<ValidatedTaskReplay[]>((resolve) => {
      resolveFetch = resolve;
    }));
    const updatedReplay = {
      ...replay,
      replayConfig: { ...replay.replayConfig, replayOutputFormat: false },
    };
    updateTaskReplayFormatGuide.mockResolvedValue(updatedReplay);

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

    const replayConfigSwitches = await screen.findAllByRole('button', { name: '' });
    expect(replayConfigSwitches[0]).toBeDisabled();

    await act(async () => {
      resolveFetch([replay]);
    });
    await waitFor(() => expect(replayConfigSwitches[0]).toBeEnabled());

    fireEvent.click(replayConfigSwitches[0]);
    fireEvent.click(screen.getByRole('button', { name: 'baselineBadge.saveSettings' }));

    await waitFor(() => {
      expect(updateTaskReplayFormatGuide).toHaveBeenCalledTimes(1);
      expect(updateTaskReplayFormatGuide).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', {
        outputFormatGuide: 'Current guide',
        replayConfig: {
          replayOutputFormat: false,
          replayToolTrace: false,
          replayReasoningChain: true,
        },
      });
    });
  });

  it('saves replay output format before opening the output format editor', async () => {
    const replayWithOutputFormatDisabled: ValidatedTaskReplay = {
      ...replay,
      replayConfig: {
        replayOutputFormat: false,
        replayToolTrace: false,
        replayReasoningChain: true,
      },
    };

    fetchTaskReplays.mockResolvedValue([replayWithOutputFormatDisabled]);
    updateTaskReplayFormatGuide.mockResolvedValue({
      ...replayWithOutputFormatDisabled,
      replayConfig: {
        replayOutputFormat: true,
        replayToolTrace: false,
        replayReasoningChain: true,
      },
    });
    const onOpenOutputFormatEditor = vi.fn();

    render(
      <ReplayBaselineSettingsDialog
        open
        onOpenChange={vi.fn()}
        playbookId="playbook-1"
        task={task}
        replay={replayWithOutputFormatDisabled}
        replayId={replayWithOutputFormatDisabled.id}
        onOpenOutputFormatEditor={onOpenOutputFormatEditor}
      />,
    );

    const replayConfigSwitches = await screen.findAllByRole('button', { name: '' });
    fireEvent.click(replayConfigSwitches[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'baselineBadge.editOutputFormatTemplate' }));

    await waitFor(() => {
      expect(updateTaskReplayFormatGuide).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', {
        outputFormatGuide: 'Current guide',
        replayConfig: {
          replayOutputFormat: true,
          replayToolTrace: false,
          replayReasoningChain: true,
        },
      });
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
