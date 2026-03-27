import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookToolbar } from './PlaybookToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  onAddStep: vi.fn(),
  onAutoLayout: vi.fn(),
  onRun: vi.fn(),
  onSave: vi.fn(),
  onViewExecutions: vi.fn(),
  onToggleDesigner: vi.fn(),
  designerOpen: false,
  isDirty: false,
  isSaving: false,
  isExecuting: false,
  canRun: true,
  executionMode: 'live' as const,
  onExecutionModeChange: vi.fn(),
};

describe('PlaybookToolbar', () => {
  it('renders all toolbar buttons', () => {
    render(<PlaybookToolbar {...defaultProps} />);
    expect(screen.getByText('toolbar.designer')).toBeInTheDocument();
    expect(screen.getByText('toolbar.addStep')).toBeInTheDocument();
    expect(screen.getByText('toolbar.autoLayout')).toBeInTheDocument();
    expect(screen.getByText('toolbar.executions')).toBeInTheDocument();
    expect(screen.getByText('toolbar.saved')).toBeInTheDocument();
    expect(screen.getByText('toolbar.run')).toBeInTheDocument();
  });

  it('calls onAddStep when add button is clicked', async () => {
    const onAddStep = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onAddStep={onAddStep} />);
    await userEvent.click(screen.getByText('toolbar.addStep'));
    expect(onAddStep).toHaveBeenCalledOnce();
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
    render(<PlaybookToolbar {...defaultProps} onViewExecutions={onViewExecutions} />);
    await userEvent.click(screen.getByText('toolbar.executions'));
    expect(onViewExecutions).toHaveBeenCalledOnce();
  });
});
