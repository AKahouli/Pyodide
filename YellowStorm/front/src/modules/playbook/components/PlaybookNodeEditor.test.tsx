import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookNodeEditor } from './PlaybookNodeEditor';
import type { PlaybookTask } from '../types';

const fetchAgents = vi.fn();
const fetchModels = vi.fn();
const fetchTaskReplays = vi.fn().mockResolvedValue([]);
const activateTaskReplay = vi.fn();
const fetchEvaluationBaseline = vi.fn();
const updateTaskReplayFormatGuide = vi.fn();
const renameTaskReplay = vi.fn();
const deleteTaskReplay = vi.fn();
const updateDataBindings = vi.fn();
const storeState = {
  fetchTaskReplays,
  activateTaskReplay,
  updateTaskReplayFormatGuide,
  fetchEvaluationBaseline,
  renameTaskReplay,
  deleteTaskReplay,
  updateDataBindings,
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
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  SearchableSelect: () => null,
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

    const nodeTypeSelect = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      vi.runOnlyPendingTimers();
    });

    act(() => {
      fireEvent.change(nodeTypeSelect, { target: { value: 'iterator' } });
    });

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

  it('renders data flow section before retry policy for generic steps', () => {
    const { container } = render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const content = container.textContent ?? '';
    expect(content.indexOf('dataFlow.sectionTitle')).toBeGreaterThan(content.indexOf('nodeEditor.sectionExecution'));
    expect(content.indexOf('nodeEditor.retryPolicy')).toBeGreaterThan(content.indexOf('dataFlow.sectionTitle'));
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
        onOpenOutputFormatEditor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('nodeEditor.sectionReplays'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'nodeEditor.replayEditFormatGuide' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'nodeEditor.replayEditFormatGuide' }));

    await waitFor(() => {
      expect(screen.getByText('baselineBadge.dialogTitle')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Baseline One')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'baselineBadge.editOutputFormatTemplate' })).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Guide text')).not.toBeInTheDocument();
    });
  });

});
