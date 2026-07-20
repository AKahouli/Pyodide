import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionFlowEditorPage } from './DecisionFlowEditorPage';

const mocks = vi.hoisted(() => ({
  canWrite: true,
  getWorkspaceArtifact: vi.fn(),
  retryWorkspaceArtifact: vi.fn(),
  selectPageWorkspace: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useBlocker: () => ({ state: 'unblocked' }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'workspace-1', artifactId: 'artifact-1' }),
}));
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({ nodes }: { nodes: Array<{ id: string }> }) => <div data-testid='react-flow'>{nodes.map((node) => <span key={node.id}>{node.id}</span>)}</div>,
  addEdge: (_connection: unknown, edges: unknown[]) => edges,
  applyEdgeChanges: (_changes: unknown, edges: unknown[]) => edges,
  applyNodeChanges: (_changes: unknown, nodes: unknown[]) => nodes,
}));
vi.mock('../../artifact-api', () => ({
  cloneWorkspaceArtifact: vi.fn(),
  getWorkspaceArtifact: mocks.getWorkspaceArtifact,
  retryWorkspaceArtifact: mocks.retryWorkspaceArtifact,
  updateWorkspaceArtifact: vi.fn(),
}));
vi.mock('../../store', () => ({
  useCanWriteWorkspace: () => mocks.canWrite,
  useWorkspaceStore: (selector: (state: { selectPageWorkspace: typeof mocks.selectPageWorkspace }) => unknown) => selector({ selectPageWorkspace: mocks.selectPageWorkspace }),
}));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: mocks.t }) };
});

const baseArtifact = {
  id: 'artifact-1',
  workspaceId: 'workspace-1',
  type: 'decision_flow',
  name: 'Eligibility flow',
  schemaVersion: 1,
  revision: 1,
  primarySource: { documentId: 'document-1', documentName: 'source.pdf', selection: { mode: 'all' } },
  generationOptions: { flowType: 'eligibility', targetAudiences: ['infer_from_document'], detailLevel: 'standard', ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true } },
  generation: { agentId: 'agent-1', requestedBy: 'user-1', attempts: 1 },
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

describe('DecisionFlowEditorPage generation states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWrite = true;
  });
  afterEach(() => vi.useRealTimers());

  it('polls a queued artifact and replaces the progress state with the ready flow', async () => {
    vi.useFakeTimers();
    mocks.getWorkspaceArtifact
      .mockResolvedValueOnce({ ...baseArtifact, status: 'queued' })
      .mockResolvedValueOnce({
        ...baseArtifact,
        status: 'ready',
        payload: { title: 'Eligibility flow', nodes: [{ id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 } }], edges: [] },
      });

    render(<DecisionFlowEditorPage />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('editor.generationStatus.queued')).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByTestId('react-flow')).toHaveTextContent('start');
    expect(mocks.getWorkspaceArtifact).toHaveBeenCalledTimes(2);
  });

  it('allows a failed generation to be retried', async () => {
    mocks.getWorkspaceArtifact.mockResolvedValue({ ...baseArtifact, status: 'failed', generation: { ...baseArtifact.generation, error: 'Generation stopped' } });
    mocks.retryWorkspaceArtifact.mockResolvedValue({ ...baseArtifact, status: 'queued' });

    render(<DecisionFlowEditorPage />);
    expect(await screen.findByText('editor.generationFailed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'editor.retryGeneration' }));

    expect(mocks.retryWorkspaceArtifact).toHaveBeenCalledWith('workspace-1', 'artifact-1');
    expect(await screen.findByText('editor.generationStatus.queued')).toBeInTheDocument();
  });

  it('does not offer generation retry to read-only users', async () => {
    mocks.canWrite = false;
    mocks.getWorkspaceArtifact.mockResolvedValue({ ...baseArtifact, status: 'failed' });

    render(<DecisionFlowEditorPage />);

    expect(await screen.findByText('editor.generationFailed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'editor.retryGeneration' })).not.toBeInTheDocument();
    expect(screen.getByText('editor.readOnly')).toBeInTheDocument();
  });
});
