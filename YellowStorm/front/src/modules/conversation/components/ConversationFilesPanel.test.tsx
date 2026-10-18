import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ConversationFilesPanel } from './ConversationFilesPanel';
import type { ConversationAsset, ConversationAssetPage } from '../api';
import { initialConversationUiState, useConversationUiStore } from '../uiStore';

const mocks = vi.hoisted(() => ({
  actor: 'alice', remove: vi.fn(), list: vi.fn(), url: vi.fn(), message: vi.fn(), download: vi.fn(), viewer: vi.fn(),
}));
vi.mock('@openuidev/react-ui', () => ({ AgentInterface: { Workspace: ({ children }: { children: ReactNode }) => <>{children}</> } }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/file-viewer', () => ({ openFileViewerFromUrlLoader: mocks.viewer }));
vi.mock('../store', () => ({ useConversationStore: (selector: (state: unknown) => unknown) => selector({ messages: [], isStreaming: false }) }));
vi.mock('../api', () => ({ fetchConversationAssets: mocks.list, getConversationAssetUrl: mocks.url, fetchMessage: mocks.message, downloadArtifactFile: mocks.download, deleteConversationAsset: mocks.remove }));
vi.mock('./openui/OpenUiAnswer', () => ({ OpenUiAnswer: ({ content, partId }: { content: string; partId: string }) => <div data-part={partId}>{content}</div> }));

const file = (overrides: Partial<ConversationAsset> = {}): ConversationAsset => ({
  ref: 'document:111111111111111111111111', name: 'example.pdf', origin: 'upload', kind: 'file', status: 'ready',
  mimeType: 'application/pdf', actions: { view: true, download: true, read: true }, ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor = 'alice';
  useConversationUiStore.setState(initialConversationUiState);
  mocks.list.mockResolvedValue({ assets: [file()], nextCursor: null });
  mocks.url.mockResolvedValue({ viewUrl: 'https://files.example/preview', downloadUrl: 'https://files.example/download' });
  mocks.download.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue({ deleted: true, alreadyDeleted: false, cleanup: { blob: 'done', index: 'done' } });
});

describe('Files & artifacts', () => {
  it('offers refinement for generated artifacts and images using their exact source refs', async () => {
    mocks.list.mockResolvedValue({ assets: [file({ ref: 'saved-app', name: 'Dashboard', origin: 'generated', kind: 'app', messageId: 'answer-1', componentId: 'program-1' }),
      file({ ref: 'saved-slides', name: 'Slides.pptx', origin: 'generated' }), file({ ref: 'uploaded-image', name: 'Image.png', kind: 'image' })], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.refine Dashboard' }));
    expect(useConversationUiStore.getState().assetPromptRequest).toMatchObject({ actorId: 'alice', conversationId: 'c1', ref: 'saved-app', name: 'Dashboard', intent: 'refine', sourceMessageId: 'answer-1' });
    expect(screen.getByRole('button', { name: 'assets.refine Slides.pptx' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assets.refine Image.png' })).toBeInTheDocument();
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('keeps the panel focused on search and file actions', async () => {
    render(<ConversationFilesPanel conversationId='c1' />);
    await screen.findByText('example.pdf');
    expect(screen.getByRole('textbox', { name: 'assets.search' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('assets.agentHint')).toBeNull();
    expect(screen.getByRole('button', { name: 'assets.useInPrompt' })).toBeInTheDocument();
  });
  it('restores pending cleanup after remount separately from available assets', async () => {
    const deleted = file({ status: 'deleted', actions: { view: false, download: false, read: false, delete: true } });
    mocks.list.mockResolvedValueOnce({ assets: [], nextCursor: null, pendingCleanup: [deleted] })
      .mockResolvedValueOnce({ assets: [], nextCursor: null, pendingCleanup: [deleted] })
      .mockResolvedValue({ assets: [], nextCursor: null });
    const view = render(<ConversationFilesPanel conversationId='c1' />);
    await screen.findByRole('button', { name: 'assets.retryCleanup example.pdf' });
    view.unmount();
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.retryCleanup example.pdf' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('c1', file().ref));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'assets.retryCleanup example.pdf' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'assets.view example.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'assets.download example.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'assets.useInPrompt' })).toBeNull();
  });

  it('confirms an exact item before deleting and refreshes the list', async () => {
    mocks.list.mockResolvedValueOnce({ assets: [file({ actions: { view: true, download: true, read: true, delete: true } })], nextCursor: null }).mockResolvedValue({ assets: [], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.delete example.pdf' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'assets.confirmDelete' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('c1', file().ref));
    await waitFor(() => expect(screen.queryByText('example.pdf')).toBeNull());
  });
  it('opens linked workspace ownership without offering conversation deletion', async () => {
    mocks.list.mockResolvedValue({ assets: [file({ origin: 'workspace', workspaceId: 'w1', actions: { view: true, download: true, read: true, delete: false } })], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    expect(await screen.findByRole('link', { name: 'assets.openWorkspace' })).toHaveAttribute('href', '#/workspace/w1');
    expect(screen.queryByRole('button', { name: 'assets.delete example.pdf' })).toBeNull();
  });
  it('keeps pending cleanup visible and allows an idempotent retry', async () => {
    mocks.list.mockResolvedValueOnce({ assets: [file({ actions: { view: true, download: true, read: true, delete: true } })], nextCursor: null }).mockResolvedValue({ assets: [], nextCursor: null });
    mocks.remove.mockResolvedValueOnce({ deleted: true, cleanup: { blob: 'pending', index: 'done' } }).mockResolvedValue({ deleted: true, alreadyDeleted: true, cleanup: { blob: 'done', index: 'done' } });
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.delete example.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'assets.confirmDelete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'assets.retryCleanup example.pdf' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('assets.cleanupPending')).toBeNull());
  });

  it('shows readable Office file types instead of raw MIME subtypes', async () => {
    mocks.list.mockResolvedValue({ assets: [file({ name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      file({ ref: 'ppt-ref', name: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
      file({ ref: 'custom-ref', name: 'notes.custom', mimeType: 'application/vnd.long-internal-custom-type' })], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    expect(await screen.findByText(/DOCX.*assets.ready/)).toBeInTheDocument();
    expect(screen.getByText(/PPTX.*assets.ready/)).toBeInTheDocument();
    expect(screen.getByText(/CUSTOM.*assets.ready/)).toBeInTheDocument();
    expect(screen.queryByText(/VND\.OPENXMLFORMATS/)).toBeNull();
  });

  it('groups persisted uploads, outputs and workspace sources without merging equal names', async () => {
    mocks.list.mockResolvedValue({ assets: [file(), file({ ref: 'artifact:m:a', origin: 'generated' }),
      file({ ref: 'document:222222222222222222222222', origin: 'workspace', name: 'knowledge.pdf' })], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    expect(await screen.findByRole('region', { name: 'assets.origin.generated' })).toBeInTheDocument();
    expect(screen.getAllByText('example.pdf')).toHaveLength(2);
    expect(screen.getByText('knowledge.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'assets.useInPrompt' })[0]);
    expect(useConversationUiStore.getState().assetPromptRequest).toMatchObject({ actorId: 'alice', conversationId: 'c1', ref: file().ref });
  });

  it('resolves a new authorized URL for preview refresh and every download', async () => {
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.download example.pdf' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('https://files.example/download', 'example.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'assets.view example.pdf' }));
    await waitFor(() => expect(mocks.viewer).toHaveBeenCalled());
    expect(mocks.viewer.mock.calls[0][0]).toBe(`asset:alice:c1:${file().ref}`);
    const load = mocks.viewer.mock.calls[0][3] as () => Promise<unknown>;
    await load();
    expect(mocks.url).toHaveBeenCalledTimes(3);
  });

  it('restores from the server after remount, without loading or rerunning an answer', async () => {
    const view = render(<ConversationFilesPanel conversationId='c1' />);
    await screen.findByText('example.pdf');
    view.unmount();
    render(<ConversationFilesPanel conversationId='c1' />);
    await screen.findByText('example.pdf');
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it('ignores a late private listing when the actor changes', async () => {
    let finish!: (page: ConversationAssetPage) => void;
    mocks.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<ConversationFilesPanel conversationId='c1' />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    mocks.actor = 'bob';
    mocks.list.mockResolvedValue({ assets: [file({ name: 'bob.pdf' })], nextCursor: null });
    view.rerender(<ConversationFilesPanel conversationId='c2' />);
    await screen.findByText('bob.pdf');
    await act(async () => finish({ assets: [file({ name: 'alice-private.pdf' })], nextCursor: null }));
    expect(screen.queryByText('alice-private.pdf')).toBeNull();
    expect(screen.getByText('bob.pdf')).toBeInTheDocument();
  });

  it('pages server results and filters on the backend, rather than just visible messages', async () => {
    mocks.list.mockResolvedValueOnce({ assets: [file()], nextCursor: 'page-2' }).mockResolvedValue({ assets: [], nextCursor: null });
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.next' }));
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('c1', expect.objectContaining({ cursor: 'page-2' }), expect.any(AbortSignal)));
    fireEvent.change(screen.getByRole('textbox', { name: 'assets.search' }), { target: { value: 'report' } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith('c1', expect.objectContaining({ cursor: undefined, search: 'report' }), expect.any(AbortSignal)));
  });

  it('opens an unloaded saved app with its original component identity', async () => {
    mocks.list.mockResolvedValue({ assets: [file({ kind: 'app', name: 'Sales app', messageId: 'm1', componentId: 'p1', actions: { view: true, download: false, read: true } })], nextCursor: null });
    mocks.message.mockResolvedValue({ components: [{ id: 'p1', type: 'text', data: { content: 'root = MiniApp("saved")' } }] });
    render(<ConversationFilesPanel conversationId='c1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'assets.view Sales app' }));
    expect(await screen.findByText('root = MiniApp("saved")')).toHaveAttribute('data-part', 'p1');
    expect(mocks.message).toHaveBeenCalledWith('c1', 'm1');
  });
});
