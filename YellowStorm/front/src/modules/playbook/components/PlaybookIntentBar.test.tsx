import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookIntentBar } from './PlaybookIntentBar';
import type { PlaybookTask, IntentSuggestionHistoryEntry, PlaybookIntentSuggestion } from '../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, options?: Record<string, string>) => {
    if (key === 'intentBar.selectedPlaceholder') {
      return `Improve or extend "${options?.title || ''}"`;
    }
    return key;
  } }),
}));

const defaultProps = {
  loading: false,
  value: 'Add a review step',
  suggestions: [] as PlaybookIntentSuggestion[],
  error: '',
  history: [] as IntentSuggestionHistoryEntry[],
  autoApply: true,
  onValueChange: vi.fn(),
  onAutoApplyChange: vi.fn(),
  onSubmit: vi.fn(),
  onApplySuggestion: vi.fn(),
  onRecordHistory: vi.fn(),
};

describe('PlaybookIntentBar', () => {
  const selectedTask: PlaybookTask = {
    id: 'task-1',
    title: 'Analyze contract',
    description: 'Review the contract terms.',
    assignedAgentId: null,
    executionOrder: 0,
    positionX: 0,
    positionY: 0,
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    clarificationPrompt: '',
    maxClarifications: 3,
    inputKeys: [],
    outputKey: '',
    notifyOnComplete: false,
    notifyEmails: [],
    inputFiles: [],
  };

  it('submits the current intent when suggest is clicked', () => {
    const onSubmit = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByText('intentBar.actions.suggest'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('renders auto-apply enabled by default', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
      />,
    );

    expect(screen.getByRole('switch', { name: 'intentBar.actions.autoApply' })).toHaveAttribute('data-state', 'checked');
  });

  it('renders a localized fallback label when suggestion label is empty', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        suggestions={[
          {
            id: 'fallback',
            kind: 'single_change',
            label: '',
            summary: 'Add a review step',
            reason: '',
            confidence: 1,
            operationType: 'create_node',
            task: { title: 'Add a review step', description: 'Add a review step' },
            targetTaskId: null,
            isDirectIntentFallback: true,
          },
        ]}
      />,
    );

    expect(screen.getByText('intentBar.fallbackLabel')).toBeInTheDocument();
  });

  it('applies a suggestion when the apply button is clicked', () => {
    const onApplySuggestion = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        value="Improve this step"
        suggestions={[
          {
            id: 's1',
            kind: 'single_change',
            label: 'Add validation step',
            summary: 'Add a validation checkpoint after this step.',
            reason: 'Helps confirm output quality.',
            confidence: 0.8,
            operationType: 'insert_after',
            task: { title: 'Validate output', description: 'Review and validate the generated output.' },
            targetTaskId: 'task-1',
            isDirectIntentFallback: false,
          },
        ]}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    fireEvent.click(screen.getByText('intentBar.actions.apply'));
    expect(onApplySuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('renders workflow plan badges while hiding business outcome by default', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        value="Create a review workflow"
        suggestions={[
          {
            id: 'plan-1',
            kind: 'workflow_plan',
            label: 'Create review workflow',
            summary: 'Adds a draft and approval sequence.',
            reason: 'The result needs multiple coordinated steps.',
            confidence: 0.9,
            isDirectIntentFallback: false,
            impact: {
              nodesToCreate: 2,
              nodesToUpdate: 1,
              nodesToDelete: 0,
              edgesToCreate: 2,
              edgesToDelete: 0,
              affectedTaskIds: ['task-1'],
              businessOutcome: 'Business users get the full review path in one approval.',
            },
            changes: [
              {
                type: 'create_node',
                nodeRef: 'new-1',
                anchor: { mode: 'after', targetTaskId: 'task-1', nodeRef: null },
                task: { title: 'Draft review', description: 'Draft the review.' },
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('intentBar.planBadge')).toBeInTheDocument();
    expect(screen.queryByText('Business users get the full review path in one approval.')).not.toBeInTheDocument();
  });

  it('renders reason and business outcome only after show more is clicked', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        suggestions={[
          {
            id: 'plan-1',
            kind: 'workflow_plan',
            label: 'Create review workflow',
            summary: 'This summary is intentionally long enough to trigger the show more action in the suggestion card layout for the test.',
            reason: 'Hidden reason until expanded.',
            confidence: 0.9,
            isDirectIntentFallback: false,
            impact: {
              nodesToCreate: 2,
              nodesToUpdate: 1,
              nodesToDelete: 0,
              edgesToCreate: 2,
              edgesToDelete: 0,
              affectedTaskIds: ['task-1'],
              businessOutcome: 'Business users get the full review path in one approval.',
            },
            changes: [],
          },
        ]}
      />,
    );

    expect(screen.queryByText('Hidden reason until expanded.')).not.toBeInTheDocument();
    expect(screen.queryByText('Business users get the full review path in one approval.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('intentBar.showMore'));
    expect(screen.getByText('Hidden reason until expanded.')).toBeInTheDocument();
    expect(screen.getByText('Business users get the full review path in one approval.')).toBeInTheDocument();
  });

  it('does not show the no structural changes badge for edge-only workflow plans', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        suggestions={[
          {
            id: 'plan-edge-1',
            kind: 'workflow_plan',
            label: 'Remove one dependency',
            summary: 'Keeps both tasks but removes one dependency edge.',
            reason: 'The downstream step should no longer consume that input.',
            confidence: 0.9,
            isDirectIntentFallback: false,
            impact: {
              nodesToCreate: 0,
              nodesToUpdate: 0,
              nodesToDelete: 0,
              edgesToCreate: 0,
              edgesToDelete: 1,
              affectedTaskIds: ['task-1', 'task-2'],
              businessOutcome: 'The workflow keeps both tasks while removing the unwanted dependency.',
            },
            changes: [
              {
                type: 'delete_edge',
                sourceTaskId: 'task-1',
                sourceNodeRef: null,
                targetTaskId: 'task-2',
                targetNodeRef: null,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByText('intentBar.impact.noStructuralChange')).not.toBeInTheDocument();
    expect(screen.getByText('intentBar.impact.edgesDeleted')).toBeInTheDocument();
  });

  it('restores suggestions when the textarea gets focus', () => {
    const onBarClick = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        onBarClick={onBarClick}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText('Improve or extend "Analyze contract"'));
    expect(onBarClick).toHaveBeenCalledTimes(1);
  });

  it('exposes accessible header controls and calls onBarClick on title click but not on drag', () => {
    const onBarClick = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        onBarClick={onBarClick}
      />,
    );

    const headerTrigger = screen.getByRole('button', { name: 'intentBar.title' });
    const collapseTrigger = screen.getByRole('button', { name: 'intentBar.actions.collapse' });
    const dragHandle = screen.getByTestId('intent-bar-drag-handle');

    expect(collapseTrigger).toBeInTheDocument();

    fireEvent.click(headerTrigger);
    expect(onBarClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(dragHandle, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(dragHandle, { pointerId: 2, clientX: 130, clientY: 125 });
    fireEvent.pointerUp(dragHandle, { pointerId: 2, clientX: 130, clientY: 125 });
    expect(onBarClick).toHaveBeenCalledTimes(1);
  });

  it('shows applied suggestions in the inline history panel with the same card layout', () => {
    const onApplySuggestion = vi.fn();
    const onRecordHistory = vi.fn();
    const onValueChange = vi.fn();
    const onApplyHistorySuggestion = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        value="Improve this step"
        onValueChange={onValueChange}
        onApplyHistorySuggestion={onApplyHistorySuggestion}
        suggestions={[
          {
            id: 's1',
            kind: 'single_change',
            label: 'Add validation step',
            summary: 'Add a validation checkpoint after this step.',
            reason: 'Helps confirm output quality.',
            confidence: 0.8,
            operationType: 'insert_after',
            task: { title: 'Validate output', description: 'Review and validate the generated output.' },
            targetTaskId: 'task-1',
            isDirectIntentFallback: false,
          },
        ]}
        history={[
          {
            id: 'hist-1',
            suggestion: {
              id: 's1',
              kind: 'single_change',
              label: 'Add validation step',
              summary: 'Add a validation checkpoint after this step.',
              reason: 'Helps confirm output quality.',
              confidence: 0.8,
              operationType: 'insert_after',
              task: { title: 'Validate output', description: 'Review and validate the generated output.' },
              targetTaskId: 'task-1',
              isDirectIntentFallback: false,
            },
            appliedAt: Date.now(),
            intent: 'Improve this step',
            playbookId: 'playbook-1',
            playbookName: 'Test Playbook',
          },
        ]}
        onApplySuggestion={onApplySuggestion}
        onRecordHistory={onRecordHistory}
      />,
    );

    fireEvent.click(screen.getByText('intentBar.actions.apply'));
    expect(onApplySuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(onRecordHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'Improve this step');

    fireEvent.click(screen.getByRole('button', { name: 'intentBar.history.title' }));

    expect(screen.getByText('intentBar.history.title')).toBeInTheDocument();
    expect(screen.getByText('Add validation step')).toBeInTheDocument();
    expect(screen.getAllByText('Improve this step').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByText('Add validation step'));
    expect(screen.getByText('intentBar.history.confirmTitle')).toBeInTheDocument();
    expect(onApplySuggestion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('intentBar.history.confirmApply'));
    expect(onValueChange).toHaveBeenCalledWith('Improve this step');
    expect(onApplyHistorySuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(onApplySuggestion).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when intent is typed but no suggestions are returned', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        value="Some intent"
      />,
    );

    expect(screen.getByText('intentBar.emptyState')).toBeInTheDocument();
  });
});
