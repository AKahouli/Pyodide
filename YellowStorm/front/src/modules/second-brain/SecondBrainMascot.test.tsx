import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY, SecondBrainMascot, shouldShowSecondBrainMascot } from './SecondBrainMascot';
import { mockNavigate } from '@/test/setup';
import { useSecondBrainPanelStore } from './secondBrainPanelStore';

const setDesignerOpen = vi.fn();
const setCopilotMode = vi.fn();
let designerOpen = false;
let pageMode: 'design' | 'run' = 'design';
let currentExecution: { playbookId: string; status: string } | null = null;
let executionHistoryByPlaybook: Record<string, Array<{ status: string }>> = {};
let playbookDirty = false;

const secondBrainMock = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(true),
  createNewConversation: vi.fn().mockResolvedValue(true),
  selectConversation: vi.fn().mockResolvedValue(true),
  refreshHistory: vi.fn().mockResolvedValue(undefined),
  current: {} as Record<string, unknown>,
}));

vi.mock('./useSecondBrainConversation', () => ({
  useSecondBrainConversation: () => ({ ...secondBrainMock.current,
    send: secondBrainMock.send,
    createNewConversation: secondBrainMock.createNewConversation,
    selectConversation: secondBrainMock.selectConversation,
    refreshHistory: secondBrainMock.refreshHistory,
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

vi.mock('@/modules/playbook', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
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
    }),
  usePlaybookUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      selectedStepId: 'task-1',
      designerOpen,
      setDesignerOpen,
      setCopilotMode,
      pageMode,
  }),
}));

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
  return render(<MemoryRouter initialEntries={[path]}><SecondBrainMascot /></MemoryRouter>);
}

describe('SecondBrainMascot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY);
    useSecondBrainPanelStore.setState({ open: false, pendingPrompt: null });
    designerOpen = false;
    pageMode = 'design';
    currentExecution = null;
    executionHistoryByPlaybook = {};
    setViewport(1440);
    secondBrainMock.current = {
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
    secondBrainMock.current = {
      ...secondBrainMock.current,
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
    useSecondBrainPanelStore.setState({ open: true, pendingPrompt: null });
    renderMascot('/playbooks/p1');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/playbooks/p1?assistantOperation=operation-9');
    });
    expect(screen.queryByRole('button', { name: /Continue in Canvas assistant/ })).not.toBeInTheDocument();
  });

  it('keeps the canvas handoff when the impacted canvas has unsaved changes', () => {
    playbookDirty = true;
    secondBrainMock.current = {
      ...secondBrainMock.current,
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

  it('uses a modal drawer on compact viewports', () => {
    setViewport(390);
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(screen.getByRole('dialog', { name: 'Yellowmind' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize Yellowmind panel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Yellowmind' })).toBeInTheDocument();
  });

  it('renders present_choices clarifications and submits the selected option', async () => {
    secondBrainMock.current = {
      ...secondBrainMock.current,
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

    await waitFor(() => expect(secondBrainMock.send).toHaveBeenCalledWith(
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
    secondBrainMock.current = {
      ...secondBrainMock.current,
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

    await waitFor(() => expect(secondBrainMock.send).toHaveBeenCalledWith(
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
    secondBrainMock.current = {
      ...secondBrainMock.current,
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
    secondBrainMock.current = {
      ...secondBrainMock.current,
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
    await waitFor(() => expect(secondBrainMock.createNewConversation).toHaveBeenCalled());
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

  it('hides the launcher on a playbook monitor or active run', () => {
    expect(shouldShowSecondBrainMascot(true, 'run', undefined)).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', 'running')).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', 'interrupted')).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', 'pending_approval')).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', undefined)).toBe(true);
    expect(shouldShowSecondBrainMascot(false, 'run', 'running')).toBe(true);

    pageMode = 'run';
    renderMascot('/playbooks/p1');
    expect(screen.queryByRole('button', { name: 'Open Yellowmind' })).not.toBeInTheDocument();
  });

  it('hides the launcher when the latest execution summary is active', () => {
    executionHistoryByPlaybook = { p1: [{ status: 'running' }] };

    renderMascot('/playbooks/p1');

    expect(screen.queryByRole('button', { name: 'Open Yellowmind' })).not.toBeInTheDocument();
  });
});
