import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookToolbar } from './PlaybookToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  pageMode: 'design' as const,
  onPageModeChange: vi.fn(),
  hasExecutionContext: false,
  onRun: vi.fn(),
  onSave: vi.fn(),
  onViewExecutions: vi.fn(),
  onToggleCopilot: vi.fn(),
  copilotOpen: false,
  isDirty: false,
  isSaving: false,
  isExecuting: false,
  canRun: true,
  executionMode: 'live' as const,
  onExecutionModeChange: vi.fn(),
  nodeReflectionEnabled: true,
  onNodeReflectionChange: vi.fn(),
  onDownloadAllResults: vi.fn(),
  canDownloadAllResults: true,
};

describe('PlaybookToolbar', () => {
  it('renders all toolbar buttons', () => {
    render(<PlaybookToolbar {...defaultProps} />);
    expect(screen.getByText('mode.design')).toBeInTheDocument();
    expect(screen.getByText('mode.run')).toBeInTheDocument();
    expect(screen.getByText('toolbar.designer')).toBeInTheDocument();
    expect(screen.getByText('toolbar.runSettings')).toBeInTheDocument();
    expect(screen.getByText('execution.downloadAllResults')).toBeInTheDocument();
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

  it('shows starting label when executing', () => {
    render(<PlaybookToolbar {...defaultProps} isExecuting={true} />);
    expect(screen.getByText('toolbar.starting')).toBeInTheDocument();
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

  it('calls onDownloadAllResults when download button is clicked', async () => {
    const onDownloadAllResults = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onDownloadAllResults={onDownloadAllResults} />);
    await userEvent.click(screen.getByText('execution.downloadAllResults'));
    expect(onDownloadAllResults).toHaveBeenCalledOnce();
  });

  it('shows run settings content when the popover is opened', async () => {
    render(<PlaybookToolbar {...defaultProps} />);
    await userEvent.click(screen.getByText('toolbar.runSettings'));
    expect(screen.getByText('toolbar.executionModeLabel')).toBeInTheDocument();
    expect(screen.getByText('toolbar.advisor')).toBeInTheDocument();
  });
});
