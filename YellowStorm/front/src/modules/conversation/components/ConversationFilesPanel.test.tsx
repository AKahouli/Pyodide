import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ConversationFilesPanel } from './ConversationFilesPanel';
import type { ConversationAsset, ConversationAssetPage } from '../api';
import { initialConversationUiState, useConversationUiStore } from '../uiStore';

const mocks = vi.hoisted(() => ({
  actor: 'alice', list: vi.fn(), url: vi.fn(), message: vi.fn(), download: vi.fn(), viewer: vi.fn(),
}));
vi.mock('@openuidev/react-ui', () => ({ AgentInterface: { Workspace: ({ children }: { children: ReactNode }) => <>{children}</> } }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/file-viewer', () => ({ openFileViewerFromUrlLoader: mocks.viewer }));
vi.mock('../store', () => ({ useConversationStore: (selector: (state: unknown) => unknown) => selector({ messages: [], isStreaming: false }) }));
vi.mock('../api', () => ({ fetchConversationAssets: mocks.list, getConversationAssetUrl: mocks.url, fetchMessage: mocks.message, downloadArtifactFile: mocks.download }));
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
});

describe('Files & artifacts', () => {
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
