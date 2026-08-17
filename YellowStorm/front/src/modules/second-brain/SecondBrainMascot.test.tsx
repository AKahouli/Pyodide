import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY, SecondBrainMascot, shouldShowSecondBrainMascot } from './SecondBrainMascot';

const setDesignerOpen = vi.fn();
let designerOpen = false;
let pageMode: 'design' | 'run' = 'design';
let currentExecution: { playbookId: string; status: string } | null = null;

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
    isDirty: false,
      currentPlaybook: {
        id: 'p1',
        name: 'Lead qualification',
        tasks: [{ id: 'task-1', title: 'Score lead' }],
        nodes: [],
      },
      currentExecution,
    }),
  usePlaybookUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      selectedStepId: 'task-1',
      designerOpen,
      setDesignerOpen,
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

function renderMascot() {
  return render(<MemoryRouter initialEntries={['/playbooks/p1']}><SecondBrainMascot /></MemoryRouter>);
}

describe('SecondBrainMascot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY);
    designerOpen = false;
    pageMode = 'design';
    currentExecution = null;
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
    expect(screen.getAllByText('Lead qualification')).toHaveLength(2);
    expect(screen.getByText('Selected: Score lead')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Ask about your Playbooks...'), { target: { value: 'Open it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Yellowmind' }));

    await waitFor(() => expect(screen.getByText('Ready.')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Open Playbook Canvas/ })).toHaveLength(1);
    expect(screen.queryByText('**Ready.**')).not.toBeInTheDocument();
    expect(screen.getByText('The response could not be completed.')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeInTheDocument();
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

  it('replaces the open Canvas designer with the global sidecar', () => {
    designerOpen = true;
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(setDesignerOpen).toHaveBeenCalledWith(false);
    expect(screen.getByRole('complementary', { name: 'Yellowmind' })).toBeInTheDocument();
  });

  it('hides the launcher on a playbook monitor or active run', () => {
    expect(shouldShowSecondBrainMascot(true, 'run', undefined)).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', 'running')).toBe(false);
    expect(shouldShowSecondBrainMascot(true, 'design', undefined)).toBe(true);
    expect(shouldShowSecondBrainMascot(false, 'run', 'running')).toBe(true);

    pageMode = 'run';
    renderMascot();
    expect(screen.queryByRole('button', { name: 'Open Yellowmind' })).not.toBeInTheDocument();
  });
});
