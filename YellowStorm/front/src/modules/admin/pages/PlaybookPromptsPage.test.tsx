import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlaybookPromptsPage } from './PlaybookPromptsPage';
import { updatePlaybookNodeTemplate, getAdminPlaybookSettings, getAllModels, updateAdminPlaybookSettings, getPlaybookPrompts } from '../api';
import { mockApiClient } from '@/test/setup';

const fetchAgents = vi.fn();
const invalidateNodeTemplates = vi.fn();
const useAgents = vi.fn(() => []);
const hasAnyPermission = vi.fn(() => true);

vi.mock('../hooks', () => ({
  usePermissions: () => ({ hasAnyPermission }),
}));

vi.mock('../api', () => ({
  getPlaybookPrompts: vi.fn().mockResolvedValue({ items: [] }),
  updatePlaybookPrompt: vi.fn(),
  deletePlaybookPrompt: vi.fn(),
  importPlaybookPrompts: vi.fn(),
  getPlaybookNodeTemplates: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'iterator-template-1',
        key: 'iterator',
        nodeType: 'iterator',
        title: 'Iterator',
        description: 'Iterator template',
        icon: 'RefreshCw',
        color: 'cyan',
        category: 'analysis',
        inputPorts: [{ id: 'legacy', name: 'Legacy', artifactKind: 'text', required: false }],
        outputPorts: [{ id: 'legacy-out', name: 'Legacy Out', artifactKind: 'text' }],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
        assignedAgentId: 'agent-1',
        selectedAction: 'index',
        iteratorConfig: null,
        enabled: true,
        version: 1,
        isBuiltIn: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'router-template-1',
        key: 'document-router',
        nodeType: 'router',
        title: 'Document Router',
        description: 'Route documents by type',
        icon: 'GitBranch',
        color: 'purple',
        category: 'analysis',
        inputPorts: [{ id: 'input', name: 'Input', artifactKind: 'text', required: false }],
        outputPorts: [{ id: 'stale', name: 'Stale', artifactKind: 'text' }],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
        assignedAgentId: 'agent-1',
        selectedAction: 'index',
        iteratorConfig: null,
        routerConfig: {
          outputLabels: ['contract', 'invoice', '__error__'],
          maxIterations: 4,
          defaultLabel: 'invoice',
          conditions: [],
        },
        enabled: true,
        version: 1,
        isBuiltIn: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
  createPlaybookNodeTemplate: vi.fn(),
  updatePlaybookNodeTemplate: vi.fn().mockImplementation(async (_id, payload) => ({
    id: 'iterator-template-1',
    version: 2,
    isBuiltIn: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...payload,
  })),
  deletePlaybookNodeTemplate: vi.fn(),
  importPlaybookNodeTemplates: vi.fn(),
  getAdminPlaybookSettings: vi.fn().mockResolvedValue({
    inferenceModelId: 'model-inference',
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'manual',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: {
      maxWorkflowPlanChanges: 500,
      maxInputPorts: 4,
      maxOutputPorts: 4,
      maxIteratorBodySteps: 12,
      maxIteratorBodyEdges: 24,
    },
    replayEligibilityConfidenceThreshold: 70,
    useDeterministicBlueprintBuilder: true,
  }),
  getAllModels: vi.fn().mockResolvedValue({
    models: [
      { id: 'model-inference', name: 'Inference Model', isActive: true },
    ],
  }),
  updateAdminPlaybookSettings: vi.fn().mockImplementation(async (settings) => settings),
}));

vi.mock('@/modules/playbook', async () => {
  const actual = await vi.importActual<typeof import('@/modules/playbook')>('@/modules/playbook');

  return {
    ...actual,
    usePlaybookStore: (selector: (state: { invalidateNodeTemplates: typeof invalidateNodeTemplates }) => unknown) =>
      selector({ invalidateNodeTemplates }),
  };
});

vi.mock('@/modules/agent/store', () => ({
  useAgents: () => useAgents(),
  useAgentStore: (selector: (state: { fetchAgents: typeof fetchAgents }) => unknown) =>
    selector({ fetchAgents }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} />
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: () => null,
}));

describe('PlaybookPromptsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasAnyPermission.mockReturnValue(true);
  });

  it('normalizes iterator templates and persists iteratorConfig on save', async () => {
    mockApiClient.get.mockResolvedValue({ data: { data: [] } });

    render(<PlaybookPromptsPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Iterator')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('{{items}}')).toBeInTheDocument();

    const sourceInput = screen.getByDisplayValue('{{items}}');
    fireEvent.change(sourceInput, { target: { value: '{{records}}' } });

    fireEvent.click(screen.getByRole('button', { name: /playbook\.templates\.actions\.saveTemplate/i }));

    const updateCall = vi.mocked(updatePlaybookNodeTemplate).mock.calls[0];
    expect(updateCall).toBeTruthy();

    const payload = updateCall?.[1] as Record<string, unknown>;
    expect(payload.iteratorConfig).toEqual(
      expect.objectContaining({
        source: '{{records}}',
        mode: 'item',
        itemVariable: 'item',
        outputVariable: 'processed_items',
        errorStrategy: 'stop',
      }),
    );
    expect(payload.inputPorts).toEqual([{ id: 'items', name: 'Items', artifactKind: 'data', required: false }]);
    expect(payload.outputPorts).toEqual([{ id: 'results', name: 'Results', artifactKind: 'data' }]);
    expect(payload.assignedAgentId).toBeNull();
    expect(payload.selectedAction).toBeNull();
  });

  it('normalizes router templates and persists routerConfig on save', async () => {
    mockApiClient.get.mockResolvedValue({ data: { data: [] } });

    render(<PlaybookPromptsPage />);

    await waitFor(() => {
      expect(screen.getByText('Document Router')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Document Router'));

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('contract').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByDisplayValue('invoice').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('4').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /playbook\.templates\.actions\.saveTemplate/i }));

    const updateCall = vi.mocked(updatePlaybookNodeTemplate).mock.calls.at(-1);
    expect(updateCall).toBeTruthy();

    const payload = updateCall?.[1] as Record<string, unknown>;
    expect(payload.nodeType).toBe('router');
    expect(payload.routerConfig).toEqual(
      expect.objectContaining({
        outputLabels: ['contract', 'invoice', '__error__'],
        maxIterations: 4,
        defaultLabel: 'invoice',
      }),
    );
    expect(payload.outputPorts).toEqual([
      { id: 'contract', name: 'contract', artifactKind: 'text' },
      { id: 'invoice', name: 'invoice', artifactKind: 'text' },
      { id: '__error__', name: '__error__', artifactKind: 'text' },
    ]);
    expect(payload.iteratorConfig).toBeNull();
    expect(payload.assignedAgentId).toBeNull();
    expect(payload.selectedAction).toBeNull();
  });

  it('loads and saves playbook settings when authorized', async () => {
    hasAnyPermission.mockReturnValue(true);
    mockApiClient.get.mockResolvedValue({ data: { data: [] } });

    render(<PlaybookPromptsPage />);

    await waitFor(() => {
      expect(getAdminPlaybookSettings).toHaveBeenCalled();
      expect(getAllModels).toHaveBeenCalled();
    });

    await waitFor(() => {
      const saveButtons = screen.getAllByRole('button', { name: /playbookSettings\.actions\.save/i });
      expect(saveButtons.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /playbookSettings\.actions\.save/i })[0]);

    await waitFor(() => {
      expect(updateAdminPlaybookSettings).toHaveBeenCalled();
    });
  });

  it('hides the settings section when the user lacks system.maintenance', async () => {
    hasAnyPermission.mockReturnValue(false);
    mockApiClient.get.mockResolvedValue({ data: { data: [] } });

    render(<PlaybookPromptsPage />);

    await waitFor(() => {
      expect(getPlaybookPrompts).toHaveBeenCalled();
    });

    // The settings section must not be mounted, so its API is never called.
    expect(getAdminPlaybookSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('playbookSettings.title')).not.toBeInTheDocument();
  });
});
