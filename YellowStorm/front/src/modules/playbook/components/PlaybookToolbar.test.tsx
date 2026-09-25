import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookStatusActions, PlaybookToolbar } from './PlaybookToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children: ReactNode }) => (
    <div data-value={value} data-on-change={onValueChange ? 'yes' : 'no'}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <div data-value={value}>{children}</div>,
}));

const defaultProps = {
  pageMode: 'design' as const,
  onPageModeChange: vi.fn(),
  hasExecutionContext: false,
  onViewExecutions: vi.fn(),
  nodeReflectionEnabled: true,
  onNodeReflectionChange: vi.fn(),
};

const defaultStatusProps = {
  onRun: vi.fn(),
  onSave: vi.fn(),
  isDirty: false,
  isSaving: false,
  isExecuting: false,
  canRun: true,
  hasRunnableContent: true,
  hasWorkspace: true,
};

const validationIssue = {
  id: 'required:task-1:context',
  taskId: 'task-1',
  taskName: 'Prepare report',
  portId: 'context',
  portName: 'Report context',
  artifactKind: 'text' as const,
  reason: 'missing_required_binding' as const,
};

describe('PlaybookToolbar', () => {
  it('renders all toolbar buttons', () => {
    render(<PlaybookToolbar {...defaultProps} />);
    expect(screen.getByText('mode.design')).toBeInTheDocument();
    expect(screen.getByText('mode.monitor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toolbar.runSettings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toolbar.moreActions' })).toBeInTheDocument();
  });

  it('calls onPageModeChange when a mode is selected', async () => {
    const onPageModeChange = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onPageModeChange={onPageModeChange} />);
    await userEvent.click(screen.getByText('mode.monitor'));
    expect(onPageModeChange).toHaveBeenCalledWith('run');
  });

  it('calls onRun when run button is clicked', async () => {
    const onRun = vi.fn();
    render(<PlaybookStatusActions {...defaultStatusProps} onRun={onRun} />);
    await userEvent.click(screen.getByText('toolbar.run'));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('disables run button when canRun is false', () => {
    render(<PlaybookStatusActions {...defaultStatusProps} canRun={false} />);
    const runButton = screen.getByText('toolbar.run').closest('button');
    expect(runButton).toBeDisabled();
  });

  it('disables save button when not dirty', () => {
    render(<PlaybookStatusActions {...defaultStatusProps} isDirty={false} />);
    const saveButton = screen.getByRole('button', { name: 'toolbar.saved' });
    expect(saveButton).toBeDisabled();
  });

  it('shows save label when dirty', () => {
    render(<PlaybookStatusActions {...defaultStatusProps} isDirty={true} />);
    expect(screen.getByRole('button', { name: 'toolbar.save' })).toBeInTheDocument();
  });

  it('opens actionable validation details and selects the affected issue', async () => {
    const onValidationIssueSelect = vi.fn();
    render(
      <PlaybookStatusActions
        {...defaultStatusProps}
        isDirty={false}
        validationIssues={[validationIssue]}
        onValidationIssueSelect={onValidationIssueSelect}
      />,
    );

    const trigger = screen.getByText('toolbar.readiness.blockersCount').closest('button');
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger!);
    expect(screen.getByText('Prepare report')).toBeInTheDocument();
    expect(screen.getByText('toolbar.validation.reason.missing_required_binding')).toBeInTheDocument();
    expect(screen.getByText('toolbar.validation.resolution.missing_required_binding')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Prepare report'));
    expect(onValidationIssueSelect).toHaveBeenCalledWith(validationIssue);
  });

  it('routes the header Run action to the runtime input dialog', async () => {
    function HeaderRunHarness() {
      const [dialogOpen, setDialogOpen] = useState(false);
      return (
        <>
          <PlaybookStatusActions {...defaultStatusProps} onRun={() => setDialogOpen(true)} />
          {dialogOpen ? <div role="dialog">runtime-inputs</div> : null}
        </>
      );
    }
    render(<HeaderRunHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'toolbar.run' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('runtime-inputs');
  });

  it('surfaces unconfigured workflow steps as readiness blockers', async () => {
    const onUnconfiguredTaskSelect = vi.fn();
    render(<PlaybookStatusActions {...defaultStatusProps} canRun={false} unconfiguredTasks={[
      { id: 'task-1', title: 'Prepare report', reasons: ['agent'] },
      { id: 'task-2', title: 'Review report', reasons: ['agent', 'evaluationExpectation'] },
    ]} onUnconfiguredTaskSelect={onUnconfiguredTaskSelect} />);
    await userEvent.click(screen.getByText('toolbar.readiness.blockersCount'));
    expect(screen.getByText('Prepare report')).toBeInTheDocument();
    expect(screen.getByText('Review report')).toBeInTheDocument();
    expect(screen.getAllByText('toolbar.readiness.configuration.agent')).toHaveLength(2);
    expect(screen.getByText('toolbar.readiness.configuration.evaluationExpectation')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Review report'));
    expect(onUnconfiguredTaskSelect).toHaveBeenCalledWith('task-2');
    expect(screen.getByText('toolbar.run').closest('button')).toBeDisabled();
  });

  it('shows saving label and disables when saving', () => {
    render(<PlaybookStatusActions {...defaultStatusProps} isDirty={true} isSaving={true} />);
    const saveButton = screen.getByRole('button', { name: 'toolbar.saving' });
    expect(saveButton).toBeDisabled();
  });

  it('shows stop button when executing', () => {
    const onStop = vi.fn();
    render(<PlaybookStatusActions {...defaultStatusProps} isExecuting={true} onStop={onStop} />);
    expect(screen.getByText('toolbar.stop')).toBeInTheDocument();
  });

  it('calls onStop when stop button is clicked', async () => {
    const onStop = vi.fn();
    render(<PlaybookStatusActions {...defaultStatusProps} isExecuting={true} onStop={onStop} />);
    await userEvent.click(screen.getByText('toolbar.stop'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('shows stopping label when stopping', () => {
    const onStop = vi.fn();
    render(<PlaybookStatusActions {...defaultStatusProps} isExecuting={true} isStopping={true} onStop={onStop} />);
    expect(screen.getByText('toolbar.stopping')).toBeInTheDocument();
  });

  it('calls onViewExecutions when executions button is clicked', async () => {
    const onViewExecutions = vi.fn();
    render(<PlaybookToolbar {...defaultProps} pageMode="run" onViewExecutions={onViewExecutions} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.moreActions' }));
    await userEvent.click(screen.getByText('toolbar.executions'));
    expect(onViewExecutions).toHaveBeenCalledOnce();
  });

  it('hides executions button in design mode when there is no execution context', async () => {
    render(<PlaybookToolbar {...defaultProps} pageMode="design" hasExecutionContext={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.moreActions' }));
    expect(screen.queryByText('toolbar.executions')).not.toBeInTheDocument();
  });

  it('shows run settings content when the popover is opened', async () => {
    render(<PlaybookToolbar {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));
    expect(screen.getByText('toolbar.advisor')).toBeInTheDocument();
  });

  it('calls onTriggers from inside the run settings popover', async () => {
    const onTriggers = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onTriggers={onTriggers} triggersEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));
    const triggerSwitch = screen.getByRole('switch', { name: 'toolbar.triggers' });
    await userEvent.click(triggerSwitch);
    expect(onTriggers).toHaveBeenCalledOnce();
  });

  it('shows the saved trigger as enabled after the settings sheet closes', async () => {
    const onTriggers = vi.fn();
    const { rerender } = render(<PlaybookToolbar {...defaultProps} onTriggers={onTriggers} triggersEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));
    expect(screen.getByRole('switch', { name: 'toolbar.triggers' })).not.toBeChecked();
    rerender(<PlaybookToolbar {...defaultProps} onTriggers={onTriggers} triggersEnabled />);
    expect(screen.getByRole('switch', { name: 'toolbar.triggers' })).toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: 'toolbar.triggers' }));
    expect(onTriggers).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));
    expect(screen.getByRole('switch', { name: 'toolbar.triggers' })).toBeChecked();
  });

  it('does not show trigger button in popover when onTriggers is not provided', async () => {
    render(<PlaybookToolbar {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));
    expect(screen.queryByText('toolbar.triggers')).not.toBeInTheDocument();
  });

  it('renders playbook AI override controls when design settings are provided', async () => {
    const onDesignSettingsChange = vi.fn();
    render(
      <PlaybookToolbar
        {...defaultProps}
        designSettings={{
          inferenceModelId: null,
          nodeSuggestionsMode: 'inherit',
          approvalSuggestionMode: 'manual',
        }}
        onDesignSettingsChange={onDesignSettingsChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));

    expect(screen.getByText('toolbar.aiDefaults.title')).toBeInTheDocument();
    expect(screen.getByText('toolbar.aiDefaults.nodeSuggestions')).toBeInTheDocument();
    expect(screen.getByText('toolbar.aiDefaults.approvals')).toBeInTheDocument();
  });

  it('renders node suggestion override options when design settings are provided', async () => {
    const onDesignSettingsChange = vi.fn();
    render(
      <PlaybookToolbar
        {...defaultProps}
        designSettings={{
          inferenceModelId: null,
          nodeSuggestionsMode: 'inherit',
          approvalSuggestionMode: 'manual',
        }}
        onDesignSettingsChange={onDesignSettingsChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'toolbar.runSettings' }));

    expect(screen.getAllByText('toolbar.aiDefaults.inherit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('toolbar.aiDefaults.manual').length).toBeGreaterThan(0);
    expect(screen.getAllByText('toolbar.aiDefaults.auto').length).toBeGreaterThan(0);
  });
});
