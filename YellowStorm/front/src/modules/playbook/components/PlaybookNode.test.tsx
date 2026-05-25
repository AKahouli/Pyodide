import { forwardRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookNode } from './PlaybookNode';

const storeState = vi.hoisted(() => ({
  currentPlaybook: {
    id: 'playbook-1',
    tasks: [],
  },
  selectedStepId: null as string | null,
  addInputFileToTask: vi.fn(),
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

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/agent/store', () => ({
  useAgentStore: (selector: any) => selector({ getAgentById: () => ({ name: 'Agent' }) }),
  useAgentTypes: () => [],
  useModels: () => [],
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
});
