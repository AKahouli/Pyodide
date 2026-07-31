import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTransformationTools } from './FileTransformationTools';

const mocks = vi.hoisted(() => ({
  closeViewer: vi.fn(),
  createDecisionFlowArtifact: vi.fn(),
  refreshArtifacts: vi.fn(),
}));

vi.mock('@/modules/workspace/artifact-api', () => ({
  createDecisionFlowArtifact: mocks.createDecisionFlowArtifact,
  getWorkspaceArtifactConfiguration: vi.fn().mockResolvedValue({ configured: true }),
}));
vi.mock('@/modules/workspace/store', () => ({
  useWorkspaceStore: (selector: (state: { refreshWorkspaceArtifacts: typeof mocks.refreshArtifacts }) => unknown) => selector({ refreshWorkspaceArtifacts: mocks.refreshArtifacts }),
}));
vi.mock('../store', () => ({ useFileViewerStore: (selector: (state: { closeViewer: typeof mocks.closeViewer }) => unknown) => selector({ closeViewer: mocks.closeViewer }) }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: (key: string) => key }) };
});

describe('FileTransformationTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    mocks.refreshArtifacts.mockResolvedValue(undefined);
  });

  it('opens the decision-flow configuration from the transformation menu', async () => {
    const user = userEvent.setup();
    render(<FileTransformationTools tab={{ id: 'tab-1', workspaceId: 'workspace-1', documentId: 'document-1', path: 'workspace-1/parkour.pdf', fileName: 'parkour.pdf', mimeType: 'application/pdf', url: 'https://example.test/parkour.pdf', canWriteWorkspace: true, pageCount: 8 }} />);

    const tools = await screen.findByRole('button', { name: 'transformation.tools' });
    await user.click(tools);
    await user.click(await screen.findByRole('menuitem', { name: 'transformation.decisionFlow' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('transformation.title');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByText('transformation.flowType')).toBeInTheDocument();
    expect(screen.getByText('transformation.ambiguity')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'transformation.cancel' }));
    expect(tools).toHaveFocus();
  });

  it('closes the PDF viewer and navigates to the queued artifact after creation', async () => {
    const user = userEvent.setup();
    mocks.createDecisionFlowArtifact.mockResolvedValue({ id: 'artifact-42', status: 'queued' });
    mocks.refreshArtifacts.mockReturnValue(new Promise(() => undefined));
    render(<FileTransformationTools tab={{ id: 'tab-1', workspaceId: 'workspace-1', documentId: 'document-1', path: 'workspace-1/parkour.pdf', fileName: 'parkour.pdf', mimeType: 'application/pdf', url: 'https://example.test/parkour.pdf', canWriteWorkspace: true, pageCount: 8 }} />);

    await user.click(await screen.findByRole('button', { name: 'transformation.tools' }));
    await user.click(await screen.findByRole('menuitem', { name: 'transformation.decisionFlow' }));
    await user.click(await screen.findByRole('button', { name: 'transformation.create' }));

    await waitFor(() => expect(window.location.hash).toBe('#/workspace/workspace-1/artifacts/artifact-42'));
    expect(mocks.closeViewer).toHaveBeenCalledOnce();
    expect(mocks.refreshArtifacts).toHaveBeenCalledOnce();
  });
});
