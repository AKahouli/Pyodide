import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECOND_BRAIN_PANEL_WIDTH_STORAGE_KEY, SecondBrainMascot } from './SecondBrainMascot';
import { runSecondBrainTurn } from './api';

const setDesignerOpen = vi.fn();
let designerOpen = false;

vi.mock('./api', () => ({
  runSecondBrainTurn: vi.fn(),
  confirmSecondBrainAction: vi.fn(),
  rejectSecondBrainAction: vi.fn(),
}));

vi.mock('@/modules/playbook', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    isDirty: false,
    currentPlaybook: {
      id: 'p1',
      name: 'Lead qualification',
      tasks: [{ id: 'task-1', title: 'Score lead' }],
      nodes: [],
    },
  }),
  usePlaybookUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    selectedStepId: 'task-1',
    designerOpen,
    setDesignerOpen,
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
        resize: 'Resize Yellowmind panel',
        placeholder: 'Ask about your Playbooks...',
        sendLabel: 'Send to Yellowmind',
        sending: 'Working...',
        you: 'You',
        assistant: 'Yellowmind',
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
    setViewport(1440);
  });

  it('opens as a non-modal desktop sidecar and renders deduplicated message actions', async () => {
    vi.mocked(runSecondBrainTurn).mockResolvedValue({
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      answer: '**Ready.** Open the generated workflow.',
      pendingAction: null,
      toolResults: [
        { name: 'create', status: 'completed', result: { uiTarget: { surface: 'playbook.editor', params: { playbookId: 'p1' } } } },
        { name: 'summary', status: 'completed', result: { nested: { uiTarget: { surface: 'playbook.editor', params: { playbookId: 'p1' } } } } },
      ],
    });
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));
    expect(screen.getByRole('complementary', { name: 'Yellowmind' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const resizeHandle = screen.getByRole('separator', { name: 'Resize Yellowmind panel' });
    expect(resizeHandle).toHaveAttribute('aria-valuemin', '336');
    expect(resizeHandle).toHaveAttribute('aria-valuemax', '720');
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '400');
    expect(screen.getByText('Lead qualification')).toBeInTheDocument();
    expect(screen.getByText('Selected: Score lead')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Ask about your Playbooks...'), { target: { value: 'Open it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Yellowmind' }));

    await waitFor(() => expect(screen.getByText('Ready.')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Open Playbook Canvas/ })).toHaveLength(1);
    expect(screen.queryByText('**Ready.**')).not.toBeInTheDocument();
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

  it('replaces the open Canvas designer with the global sidecar', () => {
    designerOpen = true;
    renderMascot();

    fireEvent.click(screen.getByRole('button', { name: 'Open Yellowmind' }));

    expect(setDesignerOpen).toHaveBeenCalledWith(false);
    expect(screen.getByRole('complementary', { name: 'Yellowmind' })).toBeInTheDocument();
  });
});
