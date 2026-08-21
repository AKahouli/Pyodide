import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_COPILOT_PANEL_WIDTH_STORAGE_KEY, PlatformCopilotMascot, shouldAutoConsumeExecutionHandoff } from './PlatformCopilotMascot';
import { mockNavigate } from '@/test/setup';
import { usePlatformCopilotPanelStore } from './platformCopilotPanelStore';

const setDesignerOpen = vi.fn();
const setCopilotMode = vi.fn();
const setPageMode = vi.fn();
const setExecutionPanelOpen = vi.fn();
const fetchExecutions = vi.fn().mockResolvedValue(undefined);
const fetchExecution = vi.fn().mockResolvedValue(undefined);
const viewExecutionInPanel = vi.fn();
let designerOpen = false;
let pageMode: 'design' | 'run' = 'design';
let currentExecution: { playbookId: string; status: string } | null = null;
let executionHistoryByPlaybook: Record<string, Array<{ status: string }>> = {};
let playbookDirty = false;

const platformCopilotMock = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(true),
  createNewConversation: vi.fn().mockResolvedValue(true),
  selectConversation: vi.fn().mockResolvedValue(true),
  refreshHistory: vi.fn().mockResolvedValue(undefined),
  current: {} as Record<string, unknown>,
}));

vi.mock('./usePlatformCopilotConversation', () => ({
  usePlatformCopilotConversation: () => ({ ...platformCopilotMock.current,
    send: platformCopilotMock.send,
    createNewConversation: platformCopilotMock.createNewConversation,
    selectConversation: platformCopilotMock.selectConversation,
    refreshHistory: platformCopilotMock.refreshHistory,
  }),
}));

function completedMessage() {
  return {
      id: 'assistant-1',
      conversationId: 'conversation-1',
      conversationType: 'ai',
      webSearchEnabled: false,
      isStreaming: false,
      isComplete: true,
      createdAt: new Date().toISOString(),
      components: [
        { id: 'text-1', type: 'text', data: { content: '**Ready.** Open the generated workflow.\n\n| Playbook | Owner | Status | Revision | Updated | Action |\n| --- | --- | --- | --- | --- | --- |\n| Lead qualification | Revenue operations | Active | 7 | Today | Open |\n\n```text\nthis-is-a-long-code-line-that-must-remain-contained-inside-the-assistant-message\n```' } },
        { id: 'error-1', type: 'error', data: { content: 'The response could not be completed.' } },
        { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: { surface: 'playbook.editor', params: { playbookId: 'p1' } } } } },
        { id: 'tool-2', type: 'toolInfo', data: { resultJson: { nested: { uiTarget: { surface: 'playbook.editor', params: { playbookId: 'p1' } } } } } },
      ],
    };
}

vi.mock('@/modules/playbook', () => {
  const state = () => ({
    isDirty: playbookDirty,
    currentPlaybook: {
      id: 'p1',
      name: 'Lead qualification',
      tasks: [{ id: 'task-1', title: 'Score lead' }],
      nodes: [],
    },
    currentExecution,
    executionHistoryByPlaybook,
    designerOpen,
    setDesignerOpen,
    setPageMode,
    setExecutionPanelOpen,
    fetchExecutions,
    fetchExecution,
    viewExecutionInPanel,
  });
  const usePlaybookStore = Object.assign(
    (selector: (currentState: Record<string, unknown>) => unknown) => selector(state()),
    { getState: state },
  );
  return {
    usePlaybookStore,
    usePlaybookUiStore: (selector: (currentState: Record<string, unknown>) => unknown) => selector({
      selectedStepId: 'task-1',
      designerOpen,
      setDesignerOpen,
      setCopilotMode,
      pageMode,
    }),
  };
});

vi.mock('@/modules/playbook/api', () => ({ getExecution: vi.fn() }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        title: 'Yellowmind',
        description: 'Your Playbook assistant',
        open: 'Open Yellowmind',
        close: 'Close Yellowmind',
        newConversation: 'Start a new Yellowmind conversation',
        scrollLatest: 'Scroll to the latest message',
        resize: 'Resize Yellowmind panel',
        placeholder: 'Ask about your Playbooks...',
        sendLabel: 'Send to Yellowmind',
        sending: 'Working...',
        you: 'You',
        assistant: 'Yellowmind',
        'activity.title': 'Agent activity',
        'activity.reasoning': 'Reasoning about your request',
        'activity.status.running': 'In progress',
        'activity.status.completed': 'Done',
        'activity.status.failed': 'Failed',
        'activity.status.pending': 'Queued',
        'history.open': 'Open Yellowmind conversation history',
        'history.title': 'Conversation history',
        'history.description': 'Return to an earlier Yellowmind conversation.',
        'history.search': 'Search conversations',
        'history.loading': 'Loading conversations...',
        'history.empty': 'No conversations found.',
        'history.current': 'Current conversation',
        'empty.title': 'Work with your Playbooks',
        'empty.description': 'Find and inspect a workflow.',
        'context.selectedTask': `Selected: ${String(options?.name ?? '')}`,
        'context.live': 'In context',
        'navigation.related': 'Continue in the workspace',
        'navigation.canvas': 'Open Playbook Canvas',
        'navigation.canvasDescription': 'Inspect and edit the workflow',
        'navigation.canvasAssistant': 'Continue in Canvas assistant',
        'navigation.canvasAssistantDescription': 'Follow the generated operation',
        'navigation.unsaved': 'Unsaved changes',
      };
      return values[key] ?? key;
    },
  }),
}));

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('1023') ? width < 1024 : width < 768,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderMascot(path = '/playbooks') {
  return render(<MemoryRouter initialEntries={[path]}><PlatformCopilotMascot /></MemoryRouter>);
}

describe('PlatformCopilotMascot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(PLATFORM_COPILOT_PANEL_WIDTH_STORAGE_KEY);
    usePlatformCopilotPanelStore.setState({ open: false, pendingPrompt: null });
    designerOpen = false;
    pageMode = 'design';
    currentExecution = null;
    executionHistoryByPlaybook = {};
    setPageMode.mockClear();
    setExecutionPanelOpen.mockClear();
    fetchExecutions.mockClear();
    fetchExecution.mockClear();
    viewExecutionInPanel.mockClear();
    setViewport(1440);
    platformCopilotMock.current = {
      conversationId: 'conversation-1',
      loading: false,
      historyLoading: false,
      streamingMessageId: undefined,
      streamingComponents: [],
      history: [{ id: 'conversation-1', title: 'Lead qualification', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      messages: [completedMessage()],
    };
    playbookDirty = false;
  });

  it('opens as a non-modal desktop sidecar and renders deduplicated message actions', async () => {
    const { container } = renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));
    expect(screen.getByRole('complementary', { name: 'Yellowmind' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const resizeHandle = screen.getByRole('separator', { name: 'Resize Yellowmind panel' });
    expect(resizeHandle).toHaveAttribute('aria-valuemin', '336');
    expect(resizeHandle).toHaveAttribute('aria-valuemax', '720');
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '400');
    expect(screen.getByText('Lead qualification')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Ask about your Playbooks...'), { target: { value: 'Open it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Yellowmind' }));

    await waitFor(() => expect(screen.getByText('Ready.')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Open Playbook Canvas/ })).toHaveLength(1);
    expect(screen.queryByText('**Ready.**')).not.toBeInTheDocument();
    expect(screen.getByText('The response could not be completed.')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeInTheDocument();
  });

  it('hides the canvas handoff while the impacted Playbook canvas is already open', () => {
    renderMascot('/playbooks/p1');
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.queryByRole('button', { name: /Open Playbook Canvas/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Continue in the workspace')).not.toBeInTheDocument();
  });

  it('keeps the canvas handoff when another Playbook canvas is open', () => {
    renderMascot('/playbooks/p2');
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getAllByRole('button', { name: /Open Playbook Canvas/ })).toHaveLength(1);
  });

  it('auto-consumes the assistant operation when the impacted canvas is already open', async () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-handoff',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'text-1', type: 'text', data: { content: 'Modification ready.' } },
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'operation-9' } } } } },
        ],
      }],
    };
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/playbooks/p1?assistantOperation=operation-9');
    });
    expect(screen.queryByRole('button', { name: /Continue in Canvas assistant/ })).not.toBeInTheDocument();
  });

  it('refreshes the matching canvas when Yellowmind starts an execution', async () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-execution-handoff',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: {
            surface: 'playbook.execution.details',
            params: { playbookId: 'p1', executionId: 'execution-1' },
            effects: [{ type: 'focusExecutionStatus' }],
          } } } },
        ],
      }],
    };
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1');

    await waitFor(() => expect(viewExecutionInPanel).toHaveBeenCalledWith('execution-1'));
    expect(setPageMode).toHaveBeenCalledWith('run');
    expect(setExecutionPanelOpen).toHaveBeenCalledWith(true);
    expect(fetchExecutions).toHaveBeenCalledWith('p1');
    expect(fetchExecution).toHaveBeenCalledWith('p1', 'execution-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('only consumes focused execution handoffs for the open canvas', () => {
    const target = {
      surface: 'playbook.execution.details' as const,
      params: { playbookId: 'p1', executionId: 'execution-1' },
      effects: [{ type: 'focusExecutionStatus' as const }],
    };

    expect(shouldAutoConsumeExecutionHandoff(target, 'p1')).toBe(true);
    expect(shouldAutoConsumeExecutionHandoff(target, 'p2')).toBe(false);
    expect(shouldAutoConsumeExecutionHandoff({ ...target, effects: undefined }, 'p1')).toBe(false);
  });

  it('keeps the execution handoff on a standalone execution route', () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-execution-detail',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: {
            surface: 'playbook.execution.details',
            params: { playbookId: 'p1', executionId: 'execution-1' },
            effects: [{ type: 'focusExecutionStatus' }],
          } } } },
        ],
      }],
    };
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1/executions/execution-0');

    expect(fetchExecutions).not.toHaveBeenCalled();
    expect(fetchExecution).not.toHaveBeenCalled();
    expect(viewExecutionInPanel).not.toHaveBeenCalled();
  });

  it('keeps the execution handoff on the execution-list route', () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-execution-list',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: {
            surface: 'playbook.execution.details',
            params: { playbookId: 'p1', executionId: 'execution-1' },
            effects: [{ type: 'focusExecutionStatus' }],
          } } } },
        ],
      }],
    };
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1/executions');

    expect(fetchExecutions).not.toHaveBeenCalled();
    expect(fetchExecution).not.toHaveBeenCalled();
    expect(viewExecutionInPanel).not.toHaveBeenCalled();
  });

  it('keeps canvas handoffs visible on the execution-list route', () => {
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1/executions');

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /Open Playbook Canvas/ })).toHaveLength(1);
  });

  it('does not focus a stale execution handoff after navigating away', async () => {
    let resolveHistory = () => {};
    fetchExecutions.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveHistory = resolve;
    }));
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-stale-execution-handoff',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: {
            surface: 'playbook.execution.details',
            params: { playbookId: 'p1', executionId: 'execution-1' },
            effects: [{ type: 'focusExecutionStatus' }],
          } } } },
        ],
      }],
    };
    usePlatformCopilotPanelStore.setState({ open: true, pendingPrompt: null });
    const { rerender } = render(<MemoryRouter key='p1' initialEntries={['/playbooks/p1']}><PlatformCopilotMascot /></MemoryRouter>);

    rerender(<MemoryRouter key='p2' initialEntries={['/playbooks/p2']}><PlatformCopilotMascot /></MemoryRouter>);
    await act(async () => {
      resolveHistory();
      await Promise.resolve();
    });

    expect(fetchExecution).not.toHaveBeenCalled();
    expect(viewExecutionInPanel).not.toHaveBeenCalled();
  });

  it('keeps the canvas handoff when the impacted canvas has unsaved changes', () => {
    playbookDirty = true;
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-handoff',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'tool-1', type: 'toolInfo', data: { resultJson: { uiTarget: { surface: 'playbook.editor.assistant', params: { playbookId: 'p1', operationId: 'operation-9' } } } } },
        ],
      }],
    };
    renderMascot('/playbooks/p1');
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByRole('button', { name: /Continue in Canvas assistant/ })).toBeInTheDocument();
  });

  it('uses a modal drawer on compact viewports and can reopen it after closing', () => {
    setViewport(390);
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByRole('dialog', { name: 'Yellowmind' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize Yellowmind panel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Yellowmind' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));
    expect(screen.getByRole('dialog', { name: 'Yellowmind' })).toBeInTheDocument();
  });

  it('renders present_choices clarifications and submits the selected option', async () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-choice',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'choice-1', type: 'choice', data: {
            schemaVersion: 1,
            questionId: 'export_scope_placement',
            prompt: 'What should the Excel export contain, and where in the flow should it run?',
            presentation: 'list',
            selectionMode: 'single',
            submitBehavior: 'immediate',
            status: 'ready',
            options: [
              { id: 'scored_review', label: 'All scored leads', submitText: 'Add an Excel export step containing all scored leads.' },
              { id: 'approved_final', label: 'Approved leads only', submitText: 'Add an Excel export step containing only approved leads.' },
            ],
          } },
        ],
      }],
    };
    renderMascot();
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByText('What should the Excel export contain, and where in the flow should it run?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /All scored leads/ }));
    fireEvent.click(screen.getByRole('button', { name: 'choice.submit' }));

    await waitFor(() => expect(platformCopilotMock.send).toHaveBeenCalledWith(
      'Add an Excel export step containing all scored leads.',
      expect.objectContaining({
        type: 'choice',
        componentId: 'choice-1',
        questionId: 'export_scope_placement',
        sourceMessageId: 'assistant-choice',
        selectedOptions: [{ optionId: 'scored_review', label: 'All scored leads' }],
      }),
    ));
  });

  it('renders multiple present_choices as tabs and submits all answers in one send', async () => {
    const user = userEvent.setup();
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [{
        id: 'assistant-choices',
        conversationId: 'conversation-1',
        conversationType: 'ai',
        webSearchEnabled: false,
        isStreaming: false,
        isComplete: true,
        createdAt: new Date().toISOString(),
        components: [
          { id: 'choice-1', type: 'choice', data: {
            schemaVersion: 1,
            questionId: 'region',
            prompt: 'Pick a region',
            presentation: 'list',
            selectionMode: 'single',
            submitBehavior: 'explicit',
            status: 'ready',
            options: [
              { id: 'france', label: 'France', submitText: 'Use France' },
              { id: 'germany', label: 'Germany', submitText: 'Use Germany' },
            ],
          } },
          { id: 'choice-2', type: 'choice', data: {
            schemaVersion: 1,
            questionId: 'scope',
            prompt: 'Pick a scope',
            presentation: 'list',
            selectionMode: 'single',
            submitBehavior: 'explicit',
            status: 'ready',
            options: [
              { id: 'sales', label: 'Sales', submitText: 'Scope to sales' },
              { id: 'marketing', label: 'Marketing', submitText: 'Scope to marketing' },
            ],
          } },
        ],
      }],
    };
    renderMascot();
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByRole('tab', { name: /Pick a region/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pick a scope/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Pick a region/ }));
    await user.click(screen.getByRole('radio', { name: 'Germany' }));
    await user.click(screen.getByRole('tab', { name: /Pick a scope/ }));
    await user.click(screen.getByRole('radio', { name: 'Marketing' }));
    await user.click(screen.getByRole('button', { name: 'choice.submitAll' }));

    await waitFor(() => expect(platformCopilotMock.send).toHaveBeenCalledWith(
      'Use Germany Scope to marketing',
      undefined,
      [
        expect.objectContaining({
          type: 'choice',
          componentId: 'choice-1',
          questionId: 'region',
          sourceMessageId: 'assistant-choices',
          selectedOptions: [{ optionId: 'germany', label: 'Germany' }],
        }),
        expect.objectContaining({
          type: 'choice',
          componentId: 'choice-2',
          questionId: 'scope',
          sourceMessageId: 'assistant-choices',
          selectedOptions: [{ optionId: 'marketing', label: 'Marketing' }],
        }),
      ],
    ));
  });

  it('renders a readable user message for multi-interaction answers instead of raw JSON', () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      messages: [
        {
          id: 'user-answer',
          conversationId: 'conversation-1',
          conversationType: 'user',
          webSearchEnabled: false,
          isComplete: true,
          createdAt: new Date().toISOString(),
          content: '[{\n  "question": { "prompt": "Pick a region" },\n  "selectedChoices": [ { "optionId": "germany", "submitText": "Use Germany" } ]\n}]',
          interactions: [
            { type: 'choice', componentId: 'choice-1', questionId: 'region', selectionMode: 'single', selectedOptions: [{ optionId: 'germany', label: 'Germany' }], displayText: 'Germany' },
            { type: 'choice', componentId: 'choice-2', questionId: 'scope', selectionMode: 'single', selectedOptions: [{ optionId: 'sales', label: 'Sales' }], displayText: 'Sales' },
          ],
        },
      ],
    };
    renderMascot();
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByText('Germany, Sales')).toBeInTheDocument();
    expect(screen.queryByText(/selectedChoices/)).not.toBeInTheDocument();
  });

  it('renders one assistant identity for an empty placeholder plus live activity', () => {
    platformCopilotMock.current = {
      ...platformCopilotMock.current,
      streamingMessageId: 'assistant-live',
      streamingComponents: [
        { id: 'reasoning-live', type: 'reasoning', data: { content: 'private hidden reasoning' } },
        { id: 'tool-live', type: 'toolInfo', data: { title: 'search_playbooks', status: 'running', params: '{"token":"hidden"}' } },
      ],
      messages: [{
        id: 'assistant-live', conversationId: 'conversation-1', conversationType: 'ai', components: [],
        webSearchEnabled: false, isStreaming: true, isComplete: false, createdAt: new Date().toISOString(),
      }],
    };
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getAllByText('Yellowmind')).toHaveLength(2);
    expect(screen.getByText('search playbooks')).toBeInTheDocument();
    expect(screen.queryByText('private hidden reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText(/token/)).not.toBeInTheDocument();
  });

  it('provides new-conversation and searchable history controls', async () => {
    renderMascot();
    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind conversation history' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Conversation history');
    expect(screen.getByPlaceholderText('Search conversations')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start a new Yellowmind conversation' }));
    await waitFor(() => expect(platformCopilotMock.createNewConversation).toHaveBeenCalled());
  });

  it('opens the contextual Yellowmind panel on a Playbook route instead of the local designer', () => {
    renderMascot('/playbooks/p1');

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(setCopilotMode).not.toHaveBeenCalled();
    expect(setDesignerOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Yellowmind' })).toBeInTheDocument();
  });

  it('does not render a duplicate launcher while contextual Yellowmind is open', () => {
    designerOpen = true;
    renderMascot('/playbooks/p1');

    expect(screen.queryByRole('button', { name: 'Open Yellowmind' })).not.toBeInTheDocument();
  });

  it('keeps the launcher visible while the Playbook is in run mode', () => {
    pageMode = 'run';
    renderMascot('/playbooks/p1');
    expect(screen.getByRole('button', { name: 'Open Yellowmind' })).toBeInTheDocument();
  });

  it('keeps the launcher visible when the latest execution summary is active', () => {
    executionHistoryByPlaybook = { p1: [{ status: 'running' }] };

    renderMascot('/playbooks/p1');

    expect(screen.getByRole('button', { name: 'Open Yellowmind' })).toBeInTheDocument();
  });
});
