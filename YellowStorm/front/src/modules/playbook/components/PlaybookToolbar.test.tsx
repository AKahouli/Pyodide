import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookToolbar } from './PlaybookToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../utils/task-template-registry', () => ({
  TASK_TEMPLATES: [
    { id: 'summarizer', type: 'summarizer', title: 'Summarizer', description: 'Summarize', icon: 'FileText', color: 'blue', category: 'content', inputPorts: [{ id: 'source', name: 'Source Content', artifactKind: 'text', required: true }], outputPorts: [{ id: 'summary', name: 'Summary', artifactKind: 'text' }], promptTemplate: '', recommendedAgentTypeSlug: null, requiredToolNames: [] },
  ],
}));

vi.mock('../utils/port-colors', () => ({
  PORT_COLORS: { text: { icon: () => null, bg: '', ring: '', dot: '' }, document: { icon: () => null, bg: '', ring: '', dot: '' }, code: { icon: () => null, bg: '', ring: '', dot: '' }, image: { icon: () => null, bg: '', ring: '', dot: '' }, data: { icon: () => null, bg: '', ring: '', dot: '' }, slide_deck: { icon: () => null, bg: '', ring: '', dot: '' }, dashboard: { icon: () => null, bg: '', ring: '', dot: '' } },
}));

const defaultProps = {
  pageMode: 'design' as const,
  onPageModeChange: vi.fn(),
  hasExecutionContext: false,
  onAddStep: vi.fn(),
  onAddStepFromTemplate: vi.fn(),
  onAutoLayout: vi.fn(),
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
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
};

describe('PlaybookToolbar', () => {
  it('renders all toolbar buttons', () => {
    render(<PlaybookToolbar {...defaultProps} />);
    expect(screen.getByText('mode.design')).toBeInTheDocument();
    expect(screen.getByText('mode.run')).toBeInTheDocument();
    expect(screen.getByText('toolbar.designer')).toBeInTheDocument();
    expect(screen.getByText('toolbar.addBlankStep')).toBeInTheDocument();
    expect(screen.getByText('toolbar.autoLayout')).toBeInTheDocument();
    expect(screen.getByText('toolbar.saved')).toBeInTheDocument();
    expect(screen.getByText('toolbar.run')).toBeInTheDocument();
  });

  it('calls onPageModeChange when a mode is selected', async () => {
    const onPageModeChange = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onPageModeChange={onPageModeChange} />);
    await userEvent.click(screen.getByText('mode.run'));
    expect(onPageModeChange).toHaveBeenCalledWith('run');
  });

  it('calls onAddStep when add button is clicked', async () => {
    const onAddStep = vi.fn();
    render(<PlaybookToolbar {...defaultProps} onAddStep={onAddStep} />);
    await userEvent.click(screen.getByText('toolbar.addBlankStep'));
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
    render(<PlaybookToolbar {...defaultProps} pageMode="run" onViewExecutions={onViewExecutions} />);
    await userEvent.click(screen.getByText('toolbar.executions'));
    expect(onViewExecutions).toHaveBeenCalledOnce();
  });

  it('hides executions button in design mode when there is no execution context', () => {
    render(<PlaybookToolbar {...defaultProps} pageMode="design" hasExecutionContext={false} />);
    expect(screen.queryByText('toolbar.executions')).not.toBeInTheDocument();
  });
});
