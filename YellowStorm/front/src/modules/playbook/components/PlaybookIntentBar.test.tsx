import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('./PlaybookClarificationResourcePicker', () => ({
  PlaybookClarificationResourcePicker: ({ open, onSelect }: { open: boolean; onSelect: (resource: { kind: 'document'; id: string; name: string; workspaceId: string; workspaceName: string; path: string; mimeType: string }) => void }) => open ? (
    <button
      type="button"
      onClick={() => onSelect({
        kind: 'document',
        id: 'document-1',
        name: 'Q3 Report.pdf',
        workspaceId: 'workspace-1',
        workspaceName: 'Finance',
        path: '/Finance/Q3 Report.pdf',
        mimeType: 'application/pdf',
      })}
    >
      Q3 Report.pdf
    </button>
  ) : null,
}));

const defaultProps = {
  loading: false,
  value: 'Add a review step',
  suggestions: [] as PlaybookIntentSuggestion[],
  error: '',
  history: [] as IntentSuggestionHistoryEntry[],
  autoApply: false,
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

  it('does not render the auto-apply control in the floating bar', () => {
    const onAutoApplyChange = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        onAutoApplyChange={onAutoApplyChange}
      />,
    );

    expect(screen.queryByRole('switch', { name: 'intentBar.actions.autoApply' })).not.toBeInTheDocument();
    expect(onAutoApplyChange).not.toHaveBeenCalled();
  });

  it('does not render the helper hint line under the title', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
      />,
    );

    expect(screen.queryByText('intentBar.canvasHint')).not.toBeInTheDocument();
    expect(screen.queryByText('intentBar.selectedHint')).not.toBeInTheDocument();
  });

  it('uses a one-line textarea by default', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1');
  });

  it('anchors the assistant in the top left by default', () => {
    const { container } = render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('left-3');
    expect(wrapper.className).toContain('top-3');
    expect(wrapper.className).not.toContain('-translate-x-1/2');
  });

  it('hides the suggestion list while auto-apply is enabled', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        autoApply
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
      />,
    );

    expect(screen.queryByText('Add validation step')).not.toBeInTheDocument();
    expect(screen.queryByText('intentBar.actions.apply')).not.toBeInTheDocument();
  });

  it('supports controlled collapsed state', () => {
    const onCollapsedChange = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('intentBar.actions.expand'));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('renders a localized fallback label when suggestion label is empty', () => {
    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        autoApply={false}
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
        autoApply={false}
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
        autoApply={false}
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
              dataBindingsToCreate: 0,
              dataBindingsToDelete: 0,
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
        autoApply={false}
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
              dataBindingsToCreate: 0,
              dataBindingsToDelete: 0,
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
        autoApply={false}
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
              dataBindingsToCreate: 0,
              dataBindingsToDelete: 0,
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
    const onPositionChange = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        onBarClick={onBarClick}
        onPositionChange={onPositionChange}
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
    expect(onPositionChange).toHaveBeenCalledWith({ x: 30, y: 25 });
  });

  it('records applied suggestions for sidebar history', () => {
    const onApplySuggestion = vi.fn();
    const onRecordHistory = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={selectedTask}
        autoApply={false}
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

  it('shows stepped clarification choices and forwards captured answers on skip', () => {
    const onForceGenerate = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        autoApply={false}
        design={{
          status: 'needs_clarification',
          detectedIntent: 'Process invoices',
          missingRequirements: ['Datasource'],
          riskFlags: [],
          questions: [{
            id: 'q1',
            question: 'Which datasource should this workflow use?',
            reason: 'Datasource affects bindings.',
            category: 'datasource',
            required: true,
            choices: ['SharePoint', 'SAP'],
          }],
        }}
        onForceGenerate={onForceGenerate}
      />,
    );

    expect(screen.getByText('Which datasource should this workflow use?')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('SharePoint')).toBeInTheDocument();
    fireEvent.click(screen.getByText('SharePoint'));
    fireEvent.click(screen.getByText('intentBar.design.skip'));
    expect(onForceGenerate).toHaveBeenCalledWith('Which datasource should this workflow use?: SharePoint');
  });

  it('steps through choice questions and generates with a custom final answer', () => {
    const onForceGenerate = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        autoApply={false}
        design={{
          status: 'needs_clarification',
          detectedIntent: 'Process invoices',
          missingRequirements: ['Datasource', 'Output'],
          riskFlags: [],
          questions: [
            {
              id: 'q1',
              question: 'Which datasource should this workflow use?',
              reason: 'Datasource affects bindings.',
              category: 'datasource',
              required: true,
              choices: ['SharePoint', 'SAP'],
            },
            {
              id: 'q2',
              question: 'What final output should it produce?',
              reason: 'Output affects final steps.',
              category: 'output',
              required: true,
              choices: ['Summary report'],
            },
          ],
        }}
        onForceGenerate={onForceGenerate}
      />,
    );

    fireEvent.click(screen.getByText('SAP'));
    fireEvent.click(screen.getByText('intentBar.design.next'));
    fireEvent.click(screen.getByText('intentBar.design.other'));
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Approval-ready CSV export' } });
    fireEvent.click(screen.getByText('intentBar.design.generate'));

    expect(onForceGenerate).toHaveBeenCalledWith([
      'Which datasource should this workflow use?: SAP',
      'What final output should it produce?: Approval-ready CSV export',
    ].join('\n'));
  });

  it('navigates back through clarification questions and preserves answers', () => {
    const onForceGenerate = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        design={{
          status: 'needs_clarification',
          detectedIntent: 'Process invoices',
          missingRequirements: ['Datasource', 'Output'],
          riskFlags: [],
          questions: [
            {
              id: 'q1',
              question: 'Which datasource should this workflow use?',
              reason: 'Datasource affects bindings.',
              category: 'datasource',
              required: true,
              choices: ['SharePoint', 'SAP'],
            },
            {
              id: 'q2',
              question: 'What final output should it produce?',
              reason: 'Output affects final steps.',
              category: 'output',
              required: true,
              choices: ['Summary report'],
            },
          ],
        }}
        onForceGenerate={onForceGenerate}
      />,
    );

    expect(screen.getByText('intentBar.design.back')).toBeDisabled();
    fireEvent.click(screen.getByText('SAP'));
    fireEvent.click(screen.getByText('intentBar.design.next'));
    fireEvent.click(screen.getByText('Summary report'));
    fireEvent.click(screen.getByText('intentBar.design.back'));

    expect(screen.getByText('Which datasource should this workflow use?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('intentBar.design.next'));
    fireEvent.click(screen.getByText('intentBar.design.generate'));

    expect(onForceGenerate).toHaveBeenCalledWith([
      'Which datasource should this workflow use?: SAP',
      'What final output should it produce?: Summary report',
    ].join('\n'));
  });

  it('selects a workspace document for resource clarification questions', async () => {
    const onForceGenerate = vi.fn();

    render(
      <PlaybookIntentBar
        {...defaultProps}
        selectedTask={null}
        autoApply={false}
        design={{
          status: 'needs_clarification',
          detectedIntent: 'Analyze finance report',
          missingRequirements: [],
          riskFlags: [],
          questions: [{
            id: 'source',
            question: 'Which source should be analyzed?',
            reason: 'The workflow needs a concrete source.',
            category: 'datasource',
            required: true,
            choices: [],
            resourceSelector: 'workspace_or_document',
          }],
        }}
        onForceGenerate={onForceGenerate}
      />,
    );

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('intentBar.design.resource.workspace_or_document'));
    await waitFor(() => expect(screen.getByText('Q3 Report.pdf')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Q3 Report.pdf'));
    fireEvent.click(screen.getByText('intentBar.design.generate'));

    expect(onForceGenerate).toHaveBeenCalledWith(
      'Which source should be analyzed?: Q3 Report.pdf [kind=document, id=document-1, workspaceId=workspace-1, workspaceName=Finance, path=/Finance/Q3 Report.pdf, mimeType=application/pdf]',
    );
  });
});
