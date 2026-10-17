import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/modules/auth/AuthContext';
import { useConversationStore } from '../../store';
import { OpenUiAnswer } from './OpenUiAnswer';

const bridge = vi.hoisted(() => ({ flush: vi.fn(), send: vi.fn(), uuid: 0 }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('./use-mini-app-state', () => ({ useMiniAppState: () => ({ flush: bridge.flush, ready: true, status: 'saved', stateRevision: 2,
  initialState: {}, mountRevision: 1, handleStateUpdate: vi.fn() }) }));
vi.mock('./OpenUiRenderer', () => ({ default: ({ onAction }: { onAction: (event: unknown) => void }) => <button onClick={() => onAction({ type: 'AskAgent', formName: 'reader', humanFriendlyMessage: 'Read',
  params: { instruction: 'Read the document', inputs: { count: 0, enabled: false }, documentIds: ['1'.repeat(24)] }, formState: { $count: 0, $enabled: false } })}>Run task</button> }));
const mount = (actor = 'actor') => render(<AuthContext.Provider value={{ user: { id: actor } } as never}>
  <OpenUiAnswer content={'root = Card([app])\napp = MiniApp("reader", "Reader", "Read", [])'} isStreaming={false} conversationId='conversation' messageId='source' partId='part' />
</AuthContext.Provider>);

describe('mini-app agent bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks(); bridge.uuid = 0;
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) }, randomUUID: () => `request-${++bridge.uuid}` });
    bridge.flush.mockResolvedValue({ programDigest: 'd'.repeat(64), stateRevision: 2 }); bridge.send.mockResolvedValue(undefined);
    useConversationStore.setState({ messages: [], isStreaming: false, currentConversationId: 'conversation', sendMessage: bridge.send });
  });
  it('flushes typed state, blocks double clicks and allows an explicit rerun after a terminal task', async () => {
    let finish!: () => void; bridge.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = mount(); const run = await screen.findByRole('button', { name: 'Run task' });
    fireEvent.click(run); fireEvent.click(run);
    await waitFor(() => expect(bridge.send).toHaveBeenCalledOnce());
    expect(bridge.flush).toHaveBeenCalledOnce();
    expect(bridge.send.mock.calls[0][1]).toMatchObject({ requestId: 'request-1', parentMessageId: 'source', openUiSubmission: {
      appTask: { schemaVersion: 1, programDigest: 'd'.repeat(64), stateRevision: 2, documentIds: ['1'.repeat(24)] }, formState: { $count: 0, $enabled: false }, params: { inputs: { count: 0, enabled: false } },
    } });
    finish(); await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run); await waitFor(() => expect(bridge.send).toHaveBeenCalledTimes(2));
    expect(bridge.send.mock.calls[1][1].requestId).toBe('request-2');
    view.unmount(); mount(); await screen.findByRole('button', { name: 'Run task' });
    expect(bridge.send).toHaveBeenCalledTimes(2);
  });
  it('reuses the request ID after an uncertain transport failure', async () => {
    bridge.send.mockRejectedValueOnce(new Error('offline')); mount(); const run = await screen.findByRole('button', { name: 'Run task' });
    fireEvent.click(run); await screen.findByText('openui.interaction.error');
    fireEvent.click(run); await waitFor(() => expect(bridge.send).toHaveBeenCalledTimes(2));
    expect(bridge.send.mock.calls[1][1].requestId).toBe(bridge.send.mock.calls[0][1].requestId);
  });
  it('does not execute when the saved revision cannot be confirmed', async () => {
    bridge.flush.mockRejectedValue(new Error('conflict')); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Run task' }));
    await screen.findByText('openui.interaction.error'); expect(bridge.send).not.toHaveBeenCalled();
  });
  it('ignores a late flush after the actor/source component has unmounted', async () => {
    let finish!: (value: unknown) => void; bridge.flush.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Run task' }));
    view.unmount(); mount('other'); await screen.findByRole('button', { name: 'Run task' });
    finish({ programDigest: 'd'.repeat(64), stateRevision: 2 });
    await waitFor(() => expect(bridge.flush).toHaveBeenCalledOnce()); expect(bridge.send).not.toHaveBeenCalled();
  });
});
