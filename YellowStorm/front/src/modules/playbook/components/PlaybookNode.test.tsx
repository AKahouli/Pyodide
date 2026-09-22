import { forwardRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasDesignContext, CardDensityContext, NodeDataActionsContext, PlaybookNode } from './PlaybookNode';

const storeState = vi.hoisted(() => ({
  currentPlaybook: {
    id: 'playbook-1',
    tasks: [],
  },
  selectedStepId: null as string | null,
  openExecutionDetailTab: vi.fn(),
  addInputFileToTask: vi.fn(),
  bindResourceToInputPort: vi.fn(),
  removeInputFileFromTask: vi.fn(),
  currentExecution: {
    taskResults: [
      {
        taskId: 'node-1',
        status: 'completed',
        artifacts: [
          {
            portId: 'out-1',
            filename: 'report.pdf',
            artifactKind: 'document',
          },
        ],
      },
    ],
    playbookId: 'playbook-1',
  },
  executionCache: {},
} as any));

const createAgentMock = vi.hoisted(() => vi.fn());
const updateAgentMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/agent/store', () => ({
  useAgentStore: (selector: any) => selector({
    getAgentById: () => ({
      id: 'agent-1',
      name: 'Agent',
      slug: 'agent',
      agentType: { id: 'type-1', name: 'Manager' },
      role: 'role',
      description: '',
      temperature: 0.5,
      instruction: '',
      ignorePrePrompt: false,
      knowledgeBases: [],
      tools: [],
      isDefault: true,
      isDefaultForType: false,
      isActive: true,
      createdBy: '',
      createdAt: '',
      updatedAt: '',
    }),
    createAgent: createAgentMock,
    updateAgent: updateAgentMock,
  }),
  useAgentTypes: () => [],
  useModels: () => [],
}));

vi.mock('@/modules/agent/components/CreateEditAgentDialog', () => ({
  CreateEditAgentDialog: ({ open, onSave }: { open: boolean; onSave: (data: any) => void }) => open ? (
    <button
      type="button"
      onClick={() => onSave({
        name: 'Agent',
        slug: 'agent',
        agentType: 'type-1',
        role: 'role',
        description: '',
        temperature: 0.5,
        model: '',
        instruction: '',
        ignorePrePrompt: false,
        knowledgeBases: [],
        tools: [],
        skills: [],
        disabledSkills: [],
        connectors: ['connector-1'],
        connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['search'] }],
        isActive: true,
      })}
    >
      save-agent-dialog
    </button>
  ) : null,
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: any) => selector(storeState),
}));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: { Left: 'left', Right: 'right', Bottom: 'bottom' },
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock('@/components/ai-elements/node', () => ({
  Node: forwardRef<HTMLDivElement, any>(({ children, handles, ...props }, ref) => <div ref={ref} {...props}>{children}</div>),
  NodeHeader: ({ children }: any) => <div>{children}</div>,
  NodeTitle: ({ children }: any) => <div>{children}</div>,
  NodeContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: any) => <>{children}</>,
  ContextMenuTrigger: ({ children, asChild, ...props }: any) => asChild
    ? <>{children}</>
    : <div {...props}>{children}</div>,
  ContextMenuContent: ({ children }: any) => <>{children}</>,
  ContextMenuItem: ({ children }: any) => <>{children}</>,
  ContextMenuSeparator: () => null,
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('./InputFilesPopover', () => ({
  InputFilesPopover: () => null,
}));

vi.mock('./PortLabel', () => ({
  PortLabel: ({ name, warning }: { name: string; warning?: boolean }) => <span data-warning={warning ? 'true' : 'false'}>{name}</span>,
}));

describe('PlaybookNode', () => {
  function renderCompact(extra: Record<string, unknown> = {}, design = false) {
    return render(<CardDensityContext.Provider value={true}><CanvasDesignContext.Provider value={design}>
      <PlaybookNode {...({ id: 'node-1', selected: false, data: {
        id: 'node-1', title: 'Extract text', assignedAgentId: 'agent-1', executionOrder: 0,
        inputPorts: [], outputPorts: [], ...extra,
      } } as any)} />
    </CanvasDesignContext.Provider></CardDensityContext.Provider>);
  }

  it('restores a clickable Advisor score on compact cards', () => {
    renderCompact({ stepJudgeStatus: 'evaluated', stepJudgeResult: { overallScore: 0.87 } });
    const badge = screen.getByRole('button', { name: 'nodeCard.advisorEvaluation' });
    expect(badge).toHaveTextContent('87%');
    fireEvent.click(badge);
    expect(storeState.openExecutionDetailTab).toHaveBeenCalledWith('judge', 'node-1');
  });

  it('shows Advisor failure instead of a stale score', () => {
    renderCompact({ stepJudgeStatus: 'failed', stepJudgeResult: { overallScore: 90 } });
    expect(screen.getByRole('button', { name: 'nodeCard.advisorEvaluation' })).toHaveTextContent('node.advisorState.failed');
    expect(screen.queryByText('90%')).not.toBeInTheDocument();
  });

  it('shows readiness in design even after an execution', () => {
    renderCompact({ stepStatus: 'completed' }, true);
    expect(screen.getByText('nodeCard.ready')).toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });

  it('keeps compact cards free of repeated source summaries', () => {
    const { container } = renderCompact();
    expect(container.querySelector('p[title]')).not.toBeInTheDocument();
  });

  it('anchors the completed result beside the output rail', () => {
    renderCompact({ outputPorts: [{ id: 'out-1', name: 'Report', artifactKind: 'document' }] });
    const trigger = screen.getByRole('button', { name: 'nodeOutput.open' });
    expect(trigger).toHaveTextContent('nodeOutput.badge');
    expect(trigger.parentElement).toHaveClass('bottom-[calc(100%+0.375rem)]');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [],
    };
    storeState.currentExecution = {
      playbookId: 'playbook-1',
      taskResults: [
        {
          taskId: 'node-1',
          status: 'completed',
          artifacts: [
            {
              portId: 'out-1',
              filename: 'report.pdf',
              artifactKind: 'document',
            },
          ],
        },
      ],
    };
    storeState.executionCache = {};
    storeState.selectedStepId = null;
  });

  it('keeps the required-port warning when its binding is incomplete', () => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'node-1',
        targetPort: 'prompt',
        sourceKind: 'constant',
        constantValue: { text: '' },
      }],
    };

    render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Prepare report',
            description: '',
            assignedAgentId: null,
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
            notifyOnComplete: false,
            notifyEmails: [],
            inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    expect(screen.getByText('Prompt')).toHaveAttribute('data-warning', 'true');
    expect(screen.getByRole('button', { name: 'nodeContextMenu.edit' })).toBeInTheDocument();
  });

  it('creates a dedicated input port for every dropped workspace', () => {
    const updateNodeData = vi.fn();
    const payload = {
      type: 'workspace',
      kind: 'workspace',
      id: 'ws-1',
      name: 'Workspace',
      workspaceId: 'ws-1',
      metadata: { workspaceId: 'ws-1', workspaceName: 'Workspace' },
    };

    const { container } = render(
      <NodeDataActionsContext.Provider value={{ updateNodeData }}>
        <PlaybookNode
          {...({
            id: 'node-1',
            selected: false,
            data: {
              id: 'node-1',
              title: 'Save result',
              description: 'Save to workspace',
              assignedAgentId: 'agent-1',
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
              taskType: 'generic',
              inputPorts: [
                { id: 'input-context', name: 'Context', artifactKind: 'text', required: false },
                { id: 'input-template', name: 'Template', artifactKind: 'document', required: true },
              ],
              outputPorts: [],
            },
          } as any)}
        />
      </NodeDataActionsContext.Provider>,
    );

    fireEvent.drop(container.firstChild as Element, {
      dataTransfer: {
        getData: (type: string) => (type === 'application/json' ? JSON.stringify(payload) : ''),
        dropEffect: 'copy',
      },
    });

    const createdPort = updateNodeData.mock.calls[0][1].inputPorts[2];
    expect(createdPort).toEqual(expect.objectContaining({
      name: 'Workspace',
      artifactKind: 'text',
    }));
    expect(storeState.bindResourceToInputPort).toHaveBeenCalledWith('node-1', createdPort.id, expect.objectContaining({
      kind: 'workspace',
      id: 'ws-1',
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      content: 'ws-1',
    }));
  });

  it('creates a dedicated input port for every dropped document', () => {
    const updateNodeData = vi.fn();
    const payload = {
      type: 'document',
      kind: 'document',
      id: 'doc-3',
      name: 'Third document.pdf',
      metadata: {
        filepath: '/documents/third-document.pdf',
        mimeType: 'application/pdf',
      },
    };

    const { container } = render(
      <NodeDataActionsContext.Provider value={{ updateNodeData }}>
        <PlaybookNode
          {...({
            id: 'node-1',
            selected: false,
            data: {
              id: 'node-1',
              title: 'Analyze documents',
              description: 'Analyze all source documents',
              assignedAgentId: 'agent-1',
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
              taskType: 'generic',
              inputPorts: [
                { id: 'input-doc-1', name: 'First document', artifactKind: 'document', required: false },
                { id: 'input-doc-2', name: 'Second document', artifactKind: 'document', required: false },
              ],
              outputPorts: [],
            },
          } as any)}
        />
      </NodeDataActionsContext.Provider>,
    );

    fireEvent.drop(container.firstChild as Element, {
      clientY: 0,
      dataTransfer: {
        getData: (type: string) => (type === 'application/json' ? JSON.stringify(payload) : ''),
        dropEffect: 'copy',
      },
    });

    const createdPort = updateNodeData.mock.calls[0][1].inputPorts[2];
    expect(createdPort).toEqual(expect.objectContaining({
      name: 'Third document.pdf',
      artifactKind: 'document',
    }));
    expect(storeState.addInputFileToTask).toHaveBeenCalledWith('node-1', {
      ...payload,
      portId: createdPort.id,
    });
  });

  it('renders a constant document binding label on the input port', () => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [],
      dataBindings: [
        {
          id: 'binding-1',
          targetNode: 'node-1',
          targetPort: 'input-file',
          sourceKind: 'constant',
          constantValue: {
            kind: 'document',
            id: 'doc-1',
            documentId: 'doc-1',
            workspaceId: 'workspace-1',
            workspaceName: 'ClientTest',
            label: 'jeu_donnees_workflow_copilote_ia.xlsx',
            path: 'clienttest/jeu_donnees_workflow_copilote_ia.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        },
      ],
    };

    render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Load Excel',
            description: 'Load a spreadsheet',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [
              { id: 'input-file', name: 'Fichiers source', artifactKind: 'document', required: true },
            ],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    expect(screen.getByText('jeu_donnees_workflow_copilote_ia.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('Fichiers source')).not.toBeInTheDocument();
  });

  it('only uses the canvas selected prop for node highlight state', () => {
    storeState.selectedStepId = 'node-1';

    const { container, rerender } = render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: 'Summarize the document',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    expect(container.firstChild).not.toHaveClass('border-[#ffcd03]');

    rerender(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: true,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: 'Summarize the document',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    expect(container.firstChild).toHaveClass('border-[#ffcd03]');
  });

  it('does not render the complementary artifacts pane', () => {
    render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: 'Summarize the document',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
            stepStatus: 'completed',
          },
        } as any)}
      />,
    );

    expect(screen.getByText('Summarize')).toBeInTheDocument();
    expect(screen.queryByText('artifacts.title')).not.toBeInTheDocument();
  });

  it('renders iterator child status from nested execution results', () => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [
        { id: 'iterator-1' },
        { id: 'child-1', containerConfig: { parentIteratorId: 'iterator-1' } },
      ],
    };
    storeState.currentExecution = {
      playbookId: 'playbook-1',
      taskResults: [
        {
          taskId: 'iterator-1',
          iteratorIterations: [
            {
              index: 0,
              childResults: [
                { taskId: 'child-1', status: 'running' },
              ],
            },
          ],
        },
      ],
    };

    render(
      <PlaybookNode
        {...({
          id: 'child-1',
          selected: false,
          data: {
            id: 'child-1',
            title: 'Iterator child',
            description: 'Runs inside the iterator',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
            containerConfig: { parentIteratorId: 'iterator-1' },
          },
        } as any)}
      />,
    );

    expect(screen.getByText('Iterator child')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('falls back to the direct child task status when nested iterator results are missing', () => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [
        { id: 'iterator-1' },
        { id: 'child-1', containerConfig: { parentIteratorId: 'iterator-1' } },
      ],
    };
    storeState.currentExecution = {
      playbookId: 'playbook-1',
      taskResults: [
        {
          taskId: 'iterator-1',
          status: 'completed',
          iteratorIterations: [],
        },
        {
          taskId: 'child-1',
          status: 'completed',
        },
      ],
    };

    render(
      <PlaybookNode
        {...({
          id: 'child-1',
          selected: false,
          data: {
            id: 'child-1',
            title: 'Iterator child',
            description: 'Runs inside the iterator',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
            containerConfig: { parentIteratorId: 'iterator-1' },
          },
        } as any)}
      />,
    );

    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('updates default agents from the badge dialog without cloning', async () => {
    render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: 'Summarize the document',
            assignedAgentId: 'agent-1',
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
            taskType: 'generic',
            inputPorts: [],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    fireEvent.click(screen.getByText('Agent'));
    fireEvent.click(screen.getByText('save-agent-dialog'));

    await waitFor(() => {
      expect(updateAgentMock).toHaveBeenCalledTimes(1);
    });

    expect(createAgentMock).not.toHaveBeenCalled();
    expect(updateAgentMock).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      name: 'Agent',
      slug: 'agent',
      connectors: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['search'] }],
    }));
  });

  it('renders the ephemeral bottom runtime handle only when projection data requests it', () => {
    const { rerender } = render(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: '',
            executionOrder: 0,
            positionX: 0,
            positionY: 0,
            inputPorts: [],
            outputPorts: [],
          },
        } as any)}
      />,
    );

    expect(screen.queryByTestId('handle-dynamic-reasoning-runtime')).not.toBeInTheDocument();

    rerender(
      <PlaybookNode
        {...({
          id: 'node-1',
          selected: false,
          data: {
            id: 'node-1',
            title: 'Summarize',
            description: '',
            executionOrder: 0,
            positionX: 0,
            positionY: 0,
            inputPorts: [],
            outputPorts: [],
            dynamicReasoningRuntimeSourceHandleId: 'dynamic-reasoning-runtime',
          },
        } as any)}
      />,
    );

    expect(screen.getByTestId('handle-dynamic-reasoning-runtime')).toBeInTheDocument();
  });
});
