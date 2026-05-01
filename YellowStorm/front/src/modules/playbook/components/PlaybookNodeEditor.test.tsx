import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookNodeEditor } from './PlaybookNodeEditor';
import type { PlaybookTask } from '../types';

const fetchAgents = vi.fn();
const fetchTaskReplays = vi.fn().mockResolvedValue([]);
const activateTaskReplay = vi.fn();
const updateTaskReplayFormatGuide = vi.fn();
const fetchEvaluationBaseline = vi.fn();
const requestNodeSuggestions = vi.fn().mockResolvedValue({ suggestions: [] });
const storeState = {
  fetchTaskReplays,
  activateTaskReplay,
  updateTaskReplayFormatGuide,
  fetchEvaluationBaseline,
  requestNodeSuggestions,
  currentPlaybook: {
    id: 'playbook-1',
    effectiveDesignSettings: {
      inferenceModelId: null,
      resolvedInferenceModelId: null,
      nodeSuggestionsMode: 'manual',
      approvalSuggestionMode: 'auto',
    },
  },
};

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/agent/store', () => ({
  useAgents: () => [],
  useAgentStore: (selector: (state: { fetchAgents: typeof fetchAgents }) => unknown) =>
    selector({ fetchAgents }),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(storeState),
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

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: () => null,
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

describe('PlaybookNodeEditor', () => {
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

  it('requests node suggestions when asked explicitly', async () => {
    requestNodeSuggestions.mockResolvedValueOnce({
      suggestions: [
        {
          id: 'suggestion-1',
          kind: 'downstream',
          title: 'Generate report',
          description: 'Summarize contract risks for the legal team.',
          reason: 'A risk review usually ends with a report.',
          confidence: 0.84,
          position: 'after',
          connectsFromTaskId: 'task-1',
          connectsToTaskId: null,
        },
      ],
    });

    const onApplySuggestion = vi.fn();

    render(
      <PlaybookNodeEditor
        playbookId="playbook-1"
        task={genericTask}
        open
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    fireEvent.click(screen.getByText('nodeEditor.aiSuggestions.action'));

    await waitFor(() => {
      expect(requestNodeSuggestions).toHaveBeenCalledWith('playbook-1', 'task-1', {
        title: 'Analyze contract',
        description: 'Review supplier contract clauses and identify important risk indicators.',
        expectedResult: null,
      });
    });

    fireEvent.click(screen.getByText('nodeEditor.aiSuggestions.addStep'));

    expect(onApplySuggestion).toHaveBeenCalled();
  });
});
