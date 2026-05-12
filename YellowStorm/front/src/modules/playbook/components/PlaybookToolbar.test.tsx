import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookToolbar } from './PlaybookToolbar';

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
  onRun: vi.fn(),
  onSave: vi.fn(),
  onViewExecutions: vi.fn(),
  isDirty: false,
  isSaving: false,
  isExecuting: false,
  canRun: true,
  nodeReflectionEnabled: true,
  onNodeReflectionChange: vi.fn(),
};

describe('PlaybookToolbar', () => {
  it('renders all toolbar buttons', () => {
    render(<PlaybookToolbar {...defaultProps} />);
    expect(screen.getByText('mode.design')).toBeInTheDocument();
    expect(screen.getByText('mode.run')).toBeInTheDocument();
    expect(screen.getByText('toolbar.runSettings')).toBeInTheDocument();
    expect(screen.getByText('toolbar.saved')).toBeInTheDocument();
    expect(screen.getByText('toolbar.run')).toBeInTheDocument();
  });

  it('calls onPageModeChange when a mode is selected', async () => {
    const onPageModeChange = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onPageModeChange={onPageModeChange} />);
    await userEvent.click(screen.getByText('mode.run'));
    expect(onPageModeChange).toHaveBeenCalledWith('run');
  });

  it('calls onRun when run button is clicked', async () => {
    const onRun = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onRun={onRun} />);
    await userEvent.click(screen.getByText('toolbar.run'));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('disables run button when canRun is false', () => {
    render(<PlaybookToolbar {...defaultProps} canRun={false} />);
    const runButton = screen.getByText('toolbar.run').closest('button');
    expect(runButton).toBeDisabled();
  });

  it('disables save button when not dirty', () => {
    render(<PlaybookToolbar {...defaultProps} isDirty={false} />);
    const saveButton = screen.getByText('toolbar.saved').closest('button');
    expect(saveButton).toBeDisabled();
  });

  it('shows save label when dirty', () => {
    render(<PlaybookToolbar {...defaultProps} isDirty={true} />);
    expect(screen.getByText('toolbar.save')).toBeInTheDocument();
  });

  it('shows saving label and disables when saving', () => {
    render(<PlaybookToolbar {...defaultProps} isDirty={true} isSaving={true} />);
    expect(screen.getByText('toolbar.saving')).toBeInTheDocument();
    const saveButton = screen.getByText('toolbar.saving').closest('button');
    expect(saveButton).toBeDisabled();
  });

  it('shows stop button when executing', () => {
    const onStop = vi.fn();
    render(<PlaybookToolbar {...defaultProps} isExecuting={true} onStop={onStop} />);
    expect(screen.getByText('toolbar.stop')).toBeInTheDocument();
  });

  it('calls onStop when stop button is clicked', async () => {
    const onStop = vi.fn();
    render(<PlaybookToolbar {...defaultProps} isExecuting={true} onStop={onStop} />);
    await userEvent.click(screen.getByText('toolbar.stop'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('shows stopping label when stopping', () => {
    const onStop = vi.fn();
    render(<PlaybookToolbar {...defaultProps} isExecuting={true} isStopping={true} onStop={onStop} />);
    expect(screen.getByText('toolbar.stopping')).toBeInTheDocument();
  });

  it('calls onViewExecutions when executions button is clicked', async () => {
    const onViewExecutions = vi.fn();
    render(<PlaybookToolbar {...defaultProps} pageMode="run" onViewExecutions={onViewExecutions} />);
    await userEvent.click(screen.getByText('toolbar.executions'));
    expect(onViewExecutions).toHaveBeenCalledOnce();
  });

  it('hides executions button in design mode when there is no execution context', () => {
    render(<PlaybookToolbar {...defaultProps} pageMode="design" hasExecutionContext={false} />);
    expect(screen.queryByText('toolbar.executions')).not.toBeInTheDocument();
  });

  it('shows run settings content when the popover is opened', async () => {
    render(<PlaybookToolbar {...defaultProps} />);
    await userEvent.click(screen.getByText('toolbar.runSettings'));
    expect(screen.getByText('toolbar.advisor')).toBeInTheDocument();
  });

  it('calls onTriggers from inside the run settings popover', async () => {
    const onTriggers = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onTriggers={onTriggers} triggersOpen={false} />);
    await userEvent.click(screen.getByText('toolbar.runSettings'));
    const switches = screen.getAllByRole('switch');
    const triggerSwitch = switches[0];
    await userEvent.click(triggerSwitch);
    expect(onTriggers).toHaveBeenCalledOnce();
  });

  it('does not show trigger button in popover when onTriggers is not provided', async () => {
    render(<PlaybookToolbar {...defaultProps} />);
    await userEvent.click(screen.getByText('toolbar.runSettings'));
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

    await userEvent.click(screen.getByText('toolbar.runSettings'));

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

    await userEvent.click(screen.getByText('toolbar.runSettings'));

    expect(screen.getAllByText('toolbar.aiDefaults.inherit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('toolbar.aiDefaults.manual').length).toBeGreaterThan(0);
    expect(screen.getAllByText('toolbar.aiDefaults.auto').length).toBeGreaterThan(0);
  });
});
