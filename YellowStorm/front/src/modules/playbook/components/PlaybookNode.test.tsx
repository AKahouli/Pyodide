import { forwardRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeDataActionsContext, PlaybookNode } from './PlaybookNode';

const storeState = vi.hoisted(() => ({
  currentPlaybook: {
    id: 'playbook-1',
    tasks: [],
  },
  selectedStepId: null as string | null,
  addInputFileToTask: vi.fn(),
  bindResourceToInputPort: vi.fn(),
  removeInputFileFromTask: vi.fn(),
  currentExecution: {
    taskResults: [
      {
        taskId: 'node-1',
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
const updateAdminAgentMock = vi.hoisted(() => vi.fn());

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

vi.mock('@/modules/admin/api', () => ({
  updateAdminAgent: updateAdminAgentMock,
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
        connectors: [],
        isActive: true,
        isDefaultForType: true,
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
  Position: { Left: 'left', Right: 'right' },
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock('@/components/ai-elements/node', () => ({
  Node: forwardRef<HTMLDivElement, any>(({ children, handles, ...props }, ref) => <div ref={ref} {...props}>{children}</div>),
  NodeHeader: ({ children }: any) => <div>{children}</div>,
  NodeTitle: ({ children }: any) => <div>{children}</div>,
  NodeContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: any) => <button type="button">{children}</button>,
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
  PortLabel: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe('PlaybookNode', () => {
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

  it('binds a dropped workspace to the only compatible text input', () => {
    const payload = {
      type: 'workspace',
      kind: 'workspace',
      id: 'ws-1',
      name: 'Workspace',
      workspaceId: 'ws-1',
      metadata: { workspaceId: 'ws-1', workspaceName: 'Workspace' },
    };

    const { container } = render(
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
      />,
    );

    fireEvent.drop(container.firstChild as Element, {
      dataTransfer: {
        getData: (type: string) => (type === 'application/json' ? JSON.stringify(payload) : ''),
        dropEffect: 'copy',
      },
    });

    expect(storeState.bindResourceToInputPort).toHaveBeenCalledWith('node-1', 'input-context', expect.objectContaining({
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
      expect(updateAdminAgentMock).toHaveBeenCalledTimes(1);
    });

    expect(createAgentMock).not.toHaveBeenCalled();
    expect(updateAgentMock).not.toHaveBeenCalled();
    expect(updateAdminAgentMock).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      name: 'Agent',
      slug: 'agent',
      isDefaultForType: true,
    }));
  });
});
