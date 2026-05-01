import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookIntentBar } from './PlaybookIntentBar';
import type { PlaybookTask } from '../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, options?: Record<string, string>) => {
    if (key === 'intentBar.selectedPlaceholder') {
      return `Improve or extend "${options?.title || ''}"`;
    }
    return key;
  } }),
}));

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
        selectedTask={null}
        loading={false}
        value="Add a review step"
        suggestions={[]}
        error=""
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        onApplySuggestion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('intentBar.actions.suggest'));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('renders a localized fallback label when suggestion label is empty', () => {
    render(
      <PlaybookIntentBar
        selectedTask={null}
        loading={false}
        value="Add a review step"
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
        error=""
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onApplySuggestion={vi.fn()}
      />,
    );

    expect(screen.getByText('intentBar.fallbackLabel')).toBeInTheDocument();
  });

  it('applies a suggestion when a suggestion card is clicked', () => {
    const onApplySuggestion = vi.fn();

    render(
      <PlaybookIntentBar
        selectedTask={selectedTask}
        loading={false}
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
        error=""
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    fireEvent.click(screen.getByText('Add validation step'));
    expect(onApplySuggestion).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('renders workflow plan impact details', () => {
    render(
      <PlaybookIntentBar
        selectedTask={selectedTask}
        loading={false}
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
        error=""
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onApplySuggestion={vi.fn()}
      />,
    );

    expect(screen.getByText('intentBar.planBadge')).toBeInTheDocument();
    expect(screen.getByText('Business users get the full review path in one approval.')).toBeInTheDocument();
  });
});
