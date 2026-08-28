import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookNodeEditor } from './PlaybookNodeEditor';
import type { OutputFormatTemplate, PlaybookTask, ValidatedTaskReplay } from '../types';

const fetchAgents = vi.fn();
const fetchModels = vi.fn();
const fetchTaskReplays = vi.fn().mockResolvedValue([]);
const activateTaskReplay = vi.fn();
const fetchEvaluationBaseline = vi.fn();
const updateTaskReplayFormatGuide = vi.fn();
const renameTaskReplay = vi.fn();
const deleteTaskReplay = vi.fn();
const grabOutputFormatTemplate = vi.fn();
const fetchOutputFormatTemplate = vi.fn();
const updateDataBindings = vi.fn();
const saveCurrentPlaybook = vi.fn().mockResolvedValue(undefined);
const storeState = {
  fetchTaskReplays,
  activateTaskReplay,
  updateTaskReplayFormatGuide,
  fetchEvaluationBaseline,
  renameTaskReplay,
  deleteTaskReplay,
  grabOutputFormatTemplate,
  fetchOutputFormatTemplate,
  updateDataBindings,
  saveCurrentPlaybook,
  isDirty: false,
  isSaving: false,
  autosaveBackoffUntil: null as number | null,
  currentPlaybook: {
    id: 'playbook-1',
    tasks: [],
    edges: [],
    dataBindings: [],
    effectiveDesignSettings: {
      inferenceModelId: null,
      resolvedInferenceModelId: null,
      nodeSuggestionsMode: 'manual',
      approvalSuggestionMode: 'auto',
    },
  },
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('@/modules/agent/store', () => ({
  useAgents: () => [],
  useAgentStore: (selector: (state: { fetchAgents: typeof fetchAgents }) => unknown) =>
    selector({ fetchAgents }),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/modules/models', () => ({
  useModels: () => [],
  useModelsStore: (selector: (state: { fetchModels: typeof fetchModels }) => unknown) =>
    selector({ fetchModels }),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(storeState),
  useCurrentPlaybook: () => storeState.currentPlaybook,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/collapsible', async () => {
  const React = await import('react');
  const CollapsibleContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);

  return {
    Collapsible: ({
      children,
      open = false,
      onOpenChange,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <CollapsibleContext.Provider value={{ open, onOpenChange: onOpenChange ?? (() => undefined) }}>
        <div>{children}</div>
      </CollapsibleContext.Provider>
    ),
    CollapsibleTrigger: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const context = React.useContext(CollapsibleContext);
      return (
        <button
          type="button"
          {...props}
          onClick={(event) => {
            props.onClick?.(event);
            context?.onOpenChange(!context.open);
          }}
        >
          {children}
        </button>
      );
    },
    CollapsibleContent: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(CollapsibleContext);
      return context?.open ? <div>{children}</div> : null;
    },
  };
});

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react');
  const TabsContext = React.createContext<{ value: string; setValue: (value: string) => void } | null>(null);

  return {
    Tabs: ({
      children,
      value,
      onValueChange,
    }: {
      children: ReactNode;
      value: string;
      onValueChange?: (value: string) => void;
    }) => (
      <TabsContext.Provider value={{ value, setValue: onValueChange ?? (() => undefined) }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({
      children,
      value,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => {
      const context = React.useContext(TabsContext);
      return (
        <button
          type="button"
          {...props}
          onClick={(event) => {
            props.onClick?.(event);
            context?.setValue(value);
          }}
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

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ id, name, value, 'aria-labelledby': ariaLabelledBy }: { id?: string; name?: string; value?: string; 'aria-labelledby'?: string }) => (
    <button type="button" role="combobox" id={id} name={name} aria-labelledby={ariaLabelledBy}>{value}</button>
  ),
}));

vi.mock('./PlaybookDataFlowSection', () => ({
  PlaybookDataFlowSection: ({
    inputPortsOverride,
    outputPortsOverride,
    showOutputPorts = true,
    canEditOutputPortNames = true,
    canEditOutputPortKinds = true,
    canModifyOutputPorts = true,
  }: any) => (
    <div data-testid="data-flow-section">
      <span>dataFlow.sectionTitle</span>
      {inputPortsOverride?.map((p: any) => <span key={p.id}>{p.name}</span>)}
      <span data-testid="data-flow-show-outputs">{String(showOutputPorts)}</span>
      <span data-testid="data-flow-can-edit-output-names">{String(canEditOutputPortNames)}</span>
      <span data-testid="data-flow-can-edit-output-kinds">{String(canEditOutputPortKinds)}</span>
      <span data-testid="data-flow-can-modify-outputs">{String(canModifyOutputPorts)}</span>
      {showOutputPorts && outputPortsOverride?.map((p: any) => <span key={p.id} data-testid="data-flow-output-port">{p.name}</span>)}
    </div>
  ),
}));

vi.mock('./HitlPolicySummaryCard', () => ({
  HitlPolicySummaryCard: () => <div>hitl.policy.title</div>,
}));

vi.mock('./HitlBlockerCenter', () => ({
  HitlBlockerCenter: () => <div>hitl.blockers.title</div>,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Loader2: () => null,
    X: () => null,
    Plus: () => null,
    Trash2: () => null,
  };
});

const baseTask: PlaybookTask = {
  id: 'task-1',
  title: 'Evaluate result',
  description: 'Check the output',
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
  taskType: 'evaluation',
  inputPorts: [],
  outputPorts: [],
  evaluationConfig: null,
  expectedResult: null,
};

const genericTask: PlaybookTask = {
  ...baseTask,
  taskType: 'generic',
  title: 'Analyze contract',
  description: 'Review supplier contract clauses and identify important risk indicators.',
  evaluationConfig: undefined,
};

const iteratorTask: PlaybookTask = {
  ...baseTask,
  taskType: 'iterator',
  title: 'Loop items',
  description: 'Process each item',
  inputPorts: [{ id: 'legacy', name: 'Legacy', artifactKind: 'text', required: false }],
  outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
  iteratorConfig: {
    source: '{{items}}',
    mode: 'item',
    batchSize: 10,
    itemVariable: 'item',
    outputVariable: 'processed_items',
    errorStrategy: 'stop',
  },
  evaluationConfig: undefined,
};

const routerTask: PlaybookTask = {
  ...baseTask,
  taskType: 'generic',
  nodeType: 'router',
  title: 'Route document',
  description: 'Pick the next branch',
  inputPorts: [{ id: 'doc_type', name: 'Doc type', artifactKind: 'data', required: false }],
  outputPorts: [
    { id: 'retry', name: 'retry', artifactKind: 'text' },
    { id: 'done', name: 'done', artifactKind: 'text' },
  ],
  routerConfig: {
    outputLabels: ['retry', 'done'],
    maxIterations: 3,
    conditions: [],
    defaultLabel: 'done',
  },
  evaluationConfig: undefined,
};

describe('PlaybookNodeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTaskReplays.mockResolvedValue([]);
    grabOutputFormatTemplate.mockResolvedValue({
      id: 'template-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      sourceExecutionId: 'exec-1',
      sourceExecutionNumber: 1,
      templateVersion: 1,
      status: 'active',
      generationStatus: 'ready',
      formatGuide: 'Server-generated guide',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    } satisfies OutputFormatTemplate);
    fetchOutputFormatTemplate.mockResolvedValue(null);
    storeState.isDirty = false;
    storeState.isSaving = false;
    storeState.autosaveBackoffUntil = null;
  });

  it('shows the focused basic path and communicates local save progress', () => {
    vi.useFakeTimers();
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText('nodeEditor.stepTitle')).toHaveAttribute('name', 'step-title');
    expect(screen.getByLabelText('nodeEditor.instructions')).toHaveAttribute('name', 'step-instructions');
    expect(screen.getByRole('combobox', { name: 'nodeEditor.agent' })).toHaveAttribute('name', 'step-agent');
    expect(screen.getByText('nodeEditor.saveState.saved')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('nodeEditor.stepTitle'), { target: { value: 'Updated title' } });
    expect(screen.getByText('nodeEditor.saveState.saving')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('shows autosave failure and retries through the playbook store', async () => {
    storeState.isDirty = true;
    storeState.autosaveBackoffUntil = Date.now() + 1000;
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('nodeEditor.saveState.failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.saveState.retry/ }));
    await waitFor(() => {
      expect(saveCurrentPlaybook).toHaveBeenCalledWith({ reason: 'autosave' });
    });
  });

  it('settles to a truthful queued state while playbook autosave is pending', () => {
    storeState.isDirty = true;
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('nodeEditor.saveState.queued')).toBeInTheDocument();
    expect(screen.queryByText('nodeEditor.saveState.saving')).not.toBeInTheDocument();
  });

  it('does not fetch the evaluation baseline when task is null', () => {
    expect(() => {
      render(
        <PlaybookNodeEditor
          playbookId="playbook-1"
          task={null}
          open
          onOpenChange={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(fetchEvaluationBaseline).not.toHaveBeenCalled();
  });

  it('does not throw when rerendering from an evaluation task to null', () => {
    const { rerender } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(() => {
      rerender(
        <PlaybookNodeEditor
          playbookId="playbook-1"
          task={null}
          open
          onOpenChange={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    }).not.toThrow();
  });

  it('clears stale baseline state before loading another evaluation task baseline', async () => {
    fetchEvaluationBaseline
      .mockResolvedValueOnce({
        id: 'baseline-1',
        sourceExecutionId: 'exec-1',
        createdAt: '2026-04-25T00:00:00.000Z',
      })
      .mockImplementationOnce(() => new Promise(() => undefined));

    const { rerender, container } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(within(container).getAllByText(/exec-1/).length).toBeGreaterThan(0);
    });

    rerender(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, id: 'task-2', title: 'Evaluate another result' }}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(within(container).queryAllByText(/exec-1/).length).toBe(0);
    });
  });

  it('keeps in-progress description text when the same task rerenders while open', async () => {
    vi.useFakeTimers();

    const { container, rerender } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const descriptionField = Array.from(container.querySelectorAll('textarea')).find(
      (element) => (element as HTMLTextAreaElement).value === genericTask.description,
    ) as HTMLTextAreaElement;

    fireEvent.change(descriptionField, {
      target: { value: `${genericTask.description} Extra typing that should stay.` },
    });

    rerender(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...genericTask, description: genericTask.description }}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(descriptionField.value).toBe(`${genericTask.description} Extra typing that should stay.`);

    vi.useRealTimers();
  });

  it('does not render expected result placeholder for evaluation tasks', async () => {
    const { container } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      const textareas = container.querySelectorAll('textarea');
      const hasPlaceholder = Array.from(textareas).some(
        (ta) => (ta as HTMLTextAreaElement).getAttribute('placeholder') === 'nodeEditor.expectedResultPlaceholder',
      );
      expect(hasPlaceholder).toBe(false);
    });
  });

  it('associates labels with evaluation and rubric controls', () => {
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.quality/ }));
    expect(screen.getByLabelText('nodeEditor.evaluationPassThreshold')).toHaveAttribute('name', 'evaluation-pass-threshold');
    expect(screen.getByLabelText('nodeEditor.evaluationWarningThreshold')).toHaveAttribute('name', 'evaluation-warning-threshold');
    expect(screen.getByLabelText('nodeEditor.evaluationWeight')).toHaveAttribute('name', 'evaluation-score-weight');

    fireEvent.click(screen.getByText('nodeEditor.evaluationAdvanced'));
    expect(screen.getByLabelText('nodeEditor.evaluationRubricVersion')).toHaveAttribute('name', 'evaluation-rubric-version');
    expect(screen.getByLabelText('nodeEditor.evaluationWeightSemantic')).toHaveAttribute('name', 'evaluation-weight-semanticMatch');
    expect(screen.getByLabelText('nodeEditor.evaluationWeightExecution')).toHaveAttribute('name', 'evaluation-weight-executionHealth');
  });

  it('locks iterator output ports to the canonical results data port', async () => {
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={iteratorTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('data-flow-output-port')).toHaveTextContent('Results');
    });

    expect(screen.getByTestId('data-flow-can-edit-output-names')).toHaveTextContent('false');
    expect(screen.getByTestId('data-flow-can-edit-output-kinds')).toHaveTextContent('false');
    expect(screen.getByTestId('data-flow-can-modify-outputs')).toHaveTextContent('false');
    expect(screen.queryByText('dataFlow.addOutput')).not.toBeInTheDocument();
  });

  it('saves canonical iterator ports when switching node type to iterator', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { container } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    onSave.mockClear();

    const nodeTypeSelect = container.querySelector('#step-node-type') as HTMLSelectElement;

    act(() => {
      fireEvent.change(nodeTypeSelect, { target: { value: 'iterator' } });
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(nodeTypeSelect.value).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.convert.confirm' }));

    act(() => {
      vi.runAllTimers();
    });

    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        taskType: 'iterator',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false, role: 'collection' }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
      }),
    );

    vi.useRealTimers();
  });

  it('canonicalizes the execution mode when editing a legacy action node', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...genericTask, nodeType: 'action', executionMode: undefined }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    onSave.mockClear();

    fireEvent.change(screen.getByLabelText('nodeEditor.action'), { target: { value: 'delete' } });
    act(() => {
      vi.runAllTimers();
    });

    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        executionMode: 'action',
        selectedAction: 'delete',
      }),
    );
    vi.useRealTimers();
  });

  it('does not save or synthesize action defaults merely by opening the editor', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...genericTask, nodeType: 'action', executionMode: 'agent', selectedAction: undefined }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'nodeEditor.model' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('nodeEditor.dynamicReasoning.label')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('saves only the semantic field changed on an unconfigured action', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...genericTask, nodeType: 'action', executionMode: 'agent', selectedAction: undefined }}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('nodeEditor.stepTitle'), { target: { value: 'Renamed action' } });
    act(() => {
      vi.runAllTimers();
    });

    expect(onSave).toHaveBeenCalledWith('task-1', { title: 'Renamed action' });
    vi.useRealTimers();
  });

  it('keeps Data Flow available for evaluation nodes', () => {
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('data-flow-section')).toBeInTheDocument();
  });

  it('keeps router output artifact kinds editable without duplicating label editing', () => {
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={routerTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('data-flow-show-outputs')).toHaveTextContent('true');
    expect(screen.getByTestId('data-flow-can-edit-output-names')).toHaveTextContent('false');
    expect(screen.getByTestId('data-flow-can-edit-output-kinds')).toHaveTextContent('true');
    expect(screen.getByTestId('data-flow-can-modify-outputs')).toHaveTextContent('false');
    expect(screen.queryAllByTestId('data-flow-output-port')).toHaveLength(2);
  });

  it('organizes the editor into business-focused tabs while keeping global save status visible', () => {
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const setupRow = screen.getByTestId('step-setup-row');
    expect(within(setupRow).getByLabelText('nodeEditor.nodeType')).toHaveAttribute('name', 'step-node-type');
    expect(within(setupRow).getByRole('combobox', { name: 'nodeEditor.agent' })).toBeInTheDocument();
    expect(within(setupRow).getByRole('combobox', { name: 'nodeEditor.model' })).toBeInTheDocument();
    expect(within(setupRow).getByLabelText('nodeEditor.dynamicReasoning.label')).toHaveAttribute('name', 'dynamic-reasoning-enabled');
    expect(screen.getByTestId('data-flow-section')).toBeInTheDocument();
    expect(screen.queryByText('nodeEditor.retryPolicy')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('nodeEditor.stepTitle'), { target: { value: 'Business-ready step' } });

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.quality/ }));
    expect(screen.queryByTestId('data-flow-section')).not.toBeInTheDocument();
    expect(screen.getByText('nodeEditor.expectedResult')).toBeInTheDocument();
    expect(screen.getByLabelText('nodeEditor.advisorEvaluation')).toBeInTheDocument();
    expect(screen.getByText('nodeEditor.saveState.saving')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.oversight/ }));
    expect(screen.getByText('nodeEditor.retryPolicy')).toBeInTheDocument();
    expect(screen.getByText('nodeEditor.interruptSettings')).toBeInTheDocument();
    expect(screen.getByText('nodeEditor.notificationSettings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.setup/ }));
    expect(screen.getByLabelText('nodeEditor.stepTitle')).toHaveValue('Business-ready step');
  });

  it('saves Advisor controls through their existing task fields', () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    onSave.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.quality/ }));
    fireEvent.click(screen.getByLabelText('nodeEditor.advisorEvaluation'));

    act(() => {
      vi.runAllTimers();
    });

    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        disableAdvisorEvaluation: true,
      }),
    );
    vi.useRealTimers();
  });

  it('opens replay baseline settings dialog from the replay list', async () => {
    fetchTaskReplays.mockResolvedValueOnce([
      {
        id: 'replay-1',
        playbookId: 'playbook-1',
        taskId: 'task-1',
        taskTitle: 'Evaluate result',
        agentName: 'Agent',
        createdBy: 'user',
        referenceExecutionId: 'exec-1',
        referenceExecutionNumber: 1,
        validationVersion: 2,
        status: 'active',
        mode: 'strict_replay',
        toolCalls: [],
        referenceOutput: 'Reference result',
        preserveOutputFormat: true,
        outputFormatGuide: 'Guide text',
        formatGuideStatus: 'ready',
        replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: true },
        label: 'Baseline One',
        createdAt: '2026-05-23T10:00:00.000Z',
        updatedAt: '2026-05-23T10:00:00.000Z',
      },
    ]);

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: 'replay-1' }}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.quality/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'nodeEditor.replayConfigureReference' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.replayConfigureReference' }));

    await waitFor(() => {
      expect(screen.getByText('nodeEditor.referenceSubviewTitle')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Baseline One')).toBeInTheDocument();
      expect(screen.getByLabelText('nodeEditor.formatGuideLabel')).toHaveValue('Guide text');
      expect(screen.queryByRole('button', { name: 'baselineBadge.editOutputFormatTemplate' })).not.toBeInTheDocument();
    });

    const workspace = screen.getByTestId('reference-output-workspace');
    const answer = within(workspace).getByRole('region', { name: 'nodeEditor.formatGuideReference' });
    const format = within(workspace).getByLabelText('nodeEditor.formatGuideLabel');
    expect(answer.compareDocumentPosition(format) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer).toHaveClass('h-52');
    expect(format).toHaveClass('h-52');

    fireEvent.click(within(workspace).getByRole('button', { name: 'nodeEditor.referenceGenerateFormat' }));
    await waitFor(() => expect(format).toHaveValue('Server-generated guide'));
    expect(grabOutputFormatTemplate).toHaveBeenCalledWith('playbook-1', 'task-1', { executionId: 'exec-1' });
  });

  it('locks and overlays the format textarea while server generation is pending', async () => {
    const replay: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: 'Reference result',
      outputFormatGuide: 'Existing guide',
      label: 'Baseline One',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([replay]);
    grabOutputFormatTemplate.mockResolvedValue({
      id: 'template-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      sourceExecutionId: 'exec-1',
      sourceExecutionNumber: 1,
      templateVersion: 1,
      status: 'active',
      generationStatus: 'pending',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    } satisfies OutputFormatTemplate);
    fetchOutputFormatTemplate.mockResolvedValue({
      id: 'template-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      sourceExecutionId: 'exec-1',
      sourceExecutionNumber: 1,
      templateVersion: 1,
      status: 'active',
      generationStatus: 'ready',
      formatGuide: 'Finished guide',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    } satisfies OutputFormatTemplate);

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: replay.id }}
        open
        initialView="reference"
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const format = await screen.findByLabelText('nodeEditor.formatGuideLabel');
    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.referenceGenerateFormat' }));

    expect(format).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('outputFormatDialog.generating');
    await waitFor(() => expect(fetchOutputFormatTemplate).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(format).toHaveValue('Finished guide'));
    expect(format).toBeEnabled();
  });

  it('rejects a generated template from another execution without replacing the guide', async () => {
    const replay: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: 'Reference result',
      outputFormatGuide: 'Existing guide',
      label: 'Baseline One',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([replay]);
    grabOutputFormatTemplate.mockResolvedValue({
      id: 'template-other',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      sourceExecutionId: 'exec-other',
      sourceExecutionNumber: 2,
      templateVersion: 2,
      status: 'active',
      generationStatus: 'ready',
      formatGuide: 'Guide from another execution',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    } satisfies OutputFormatTemplate);

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: replay.id }}
        open
        initialView="reference"
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const format = await screen.findByLabelText('nodeEditor.formatGuideLabel');
    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.referenceGenerateFormat' }));

    await screen.findByRole('alert');
    expect(format).toHaveValue('Existing guide');
  });

  it('keeps every inactive replay individually configurable when none is active', async () => {
    const inactiveReplay: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 1,
      status: 'inactive',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: 'First reference',
      preserveOutputFormat: false,
      outputFormatGuide: null,
      formatGuideStatus: 'disabled',
      label: 'First inactive reference',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([
      inactiveReplay,
      {
        ...inactiveReplay,
        id: 'replay-2',
        referenceExecutionId: 'exec-2',
        referenceExecutionNumber: 2,
        validationVersion: 2,
        label: 'Second inactive reference',
      },
    ]);
    updateTaskReplayFormatGuide.mockImplementation(async (_playbookId: string, _taskId: string, replayId: string, data: { outputFormatGuide?: string }) => ({
      ...(replayId === 'replay-1'
        ? inactiveReplay
        : { ...inactiveReplay, id: 'replay-2', label: 'Second inactive reference' }),
      outputFormatGuide: data.outputFormatGuide,
    }));

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={baseTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /nodeEditor.tabs.quality/ }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'nodeEditor.replayConfigureReference' })).toHaveLength(3);
    });
    const configureButtons = screen.getAllByRole('button', { name: 'nodeEditor.replayConfigureReference' });

    fireEvent.click(configureButtons[1]);
    expect(await screen.findByDisplayValue('First inactive reference')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.referenceBack' }));

    const refreshedConfigureButtons = await screen.findAllByRole('button', { name: 'nodeEditor.replayConfigureReference' });
    fireEvent.click(refreshedConfigureButtons[2]);
    expect(await screen.findByDisplayValue('Second inactive reference')).toBeInTheDocument();
  });

  it('initializes and saves missing reference defaults without creating replay settings', async () => {
    const replayWithoutConfig: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: '## Reference result\n\nA concise validated answer.',
      preserveOutputFormat: false,
      outputFormatGuide: null,
      formatGuideStatus: 'disabled',
      label: null,
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([replayWithoutConfig]);
    renameTaskReplay.mockResolvedValue({ ...replayWithoutConfig, label: 'nodeEditor.referenceDefaultName' });
    updateTaskReplayFormatGuide.mockResolvedValue({
      ...replayWithoutConfig,
      label: 'nodeEditor.referenceDefaultName',
      outputFormatGuide: 'nodeEditor.referenceFormatGeneratedMarkdown',
    });
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: 'replay-1' }}
        open
        initialView="reference"
        onOpenChange={onOpenChange}
        onSave={vi.fn()}
      />,
    );

    await screen.findByText('nodeEditor.referenceSubviewTitle');
    expect(screen.getByLabelText('baselineBadge.nameLabel')).toHaveValue('nodeEditor.referenceDefaultName');
    expect(screen.getByLabelText('nodeEditor.formatGuideLabel')).toHaveValue('nodeEditor.referenceFormatGeneratedMarkdown');
    fireEvent.click(screen.getAllByRole('button', { name: 'test-dialog-close' })[0]);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByText('nodeEditor.referenceSubviewTitle')).not.toBeInTheDocument();
    });
    expect(renameTaskReplay).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', 'nodeEditor.referenceDefaultName');
    expect(updateTaskReplayFormatGuide).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', {
      outputFormatGuide: 'nodeEditor.referenceFormatGeneratedMarkdown',
    });

    rerender(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...genericTask, id: 'task-2', title: 'Second step' }}
        open
        initialView="setup"
        onOpenChange={onOpenChange}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('nodeEditor.stepTitle')).toHaveValue('Second step'));
    expect(screen.queryByText('nodeEditor.referenceSubviewTitle')).not.toBeInTheDocument();
  });

  it('does not mutate a fully configured reference when it is opened and closed unchanged', async () => {
    const configuredReplay: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: 'Reference result',
      preserveOutputFormat: false,
      outputFormatGuide: 'Return one concise paragraph.',
      formatGuideStatus: 'ready',
      label: 'Trusted result',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([configuredReplay]);

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: 'replay-1' }}
        open
        initialView="reference"
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await screen.findByDisplayValue('Return one concise paragraph.');
    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.referenceBack' }));

    await waitFor(() => expect(screen.queryByText('nodeEditor.referenceSubviewTitle')).not.toBeInTheDocument());
    expect(renameTaskReplay).not.toHaveBeenCalled();
    expect(updateTaskReplayFormatGuide).not.toHaveBeenCalled();
  });

  it('saves an expected-format-only edit without synthesizing replay settings', async () => {
    const configuredReplay: ValidatedTaskReplay = {
      id: 'replay-1',
      playbookId: 'playbook-1',
      taskId: 'task-1',
      taskTitle: 'Evaluate result',
      agentName: 'Agent',
      createdBy: 'user',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      validationVersion: 2,
      status: 'active',
      mode: 'strict_replay',
      toolCalls: [],
      referenceOutput: 'Reference result',
      preserveOutputFormat: false,
      outputFormatGuide: 'Original guide',
      formatGuideStatus: 'ready',
      label: 'Trusted result',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    };
    fetchTaskReplays.mockResolvedValue([configuredReplay]);
    updateTaskReplayFormatGuide.mockResolvedValue({ ...configuredReplay, outputFormatGuide: 'Updated guide' });

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={{ ...baseTask, hasValidatedReplay: true, activeReplayId: 'replay-1' }}
        open
        initialView="reference"
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(await screen.findByLabelText('nodeEditor.formatGuideLabel'), { target: { value: 'Updated guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.referenceBack' }));

    await waitFor(() => {
      expect(updateTaskReplayFormatGuide).toHaveBeenCalledWith('playbook-1', 'task-1', 'replay-1', {
        outputFormatGuide: 'Updated guide',
      });
    });
  });

});
