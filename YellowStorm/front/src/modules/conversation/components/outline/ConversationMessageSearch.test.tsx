import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMessageSearch, MessageRouteAnchorLoader } from './ConversationMessageSearch';
import { initialConversationUiState, useConversationUiStore } from '../../uiStore';
const search = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ currentConversationId: 'conversation', messagesLoading: false, loadMessageAround: vi.fn().mockResolvedValue(undefined) }));
const actor = vi.hoisted(() => ({ id: 'owner' }));
vi.mock('react-router-dom', async () => await vi.importActual('react-router-dom'));
vi.mock('../../api', () => ({ searchConversationMessages: search }));
vi.mock('../../store', () => ({ useConversationStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: actor }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
function Screen() { const location = useLocation(); return <><ConversationMessageSearch /><MessageRouteAnchorLoader /><output>{location.search}</output></>; }
const view = (route = '/conversation/conversation') => <MemoryRouter initialEntries={[route]}><Routes><Route path='/conversation/:id' element={<Screen />} /></Routes></MemoryRouter>;
beforeEach(() => { vi.clearAllMocks(); actor.id = 'owner'; state.currentConversationId = 'conversation'; state.messagesLoading = false; state.loadMessageAround.mockResolvedValue(undefined); useConversationUiStore.setState(initialConversationUiState); });
describe('authorized full transcript search and route navigation', () => {
  it('searches outside loaded headings and loads the selected exact target before requesting its anchor', async () => {
    search.mockResolvedValue({ matches: [{ messageId: 'old-answer', questionMessageId: 'old-question', conversationType: 'ai', snippet: 'Archived dashboard', createdAt: '2026-01-01' }], hasMore: true });
    const user = userEvent.setup(); render(view());
    await user.type(screen.getByRole('textbox', { name: 'outline.conversationSearch' }), 'Archived');
    await user.click(screen.getByRole('button', { name: 'outline.searchConversation' }));
    expect(search).toHaveBeenCalledWith('conversation', 'Archived', expect.any(AbortSignal));
    await user.click(await screen.findByRole('button', { name: 'Archived dashboard' }));
    await waitFor(() => expect(state.loadMessageAround).toHaveBeenCalledWith('old-answer', expect.any(AbortSignal)));
    expect(screen.getByText('?message=old-answer')).toBeInTheDocument();
    await waitFor(() => expect(useConversationUiStore.getState().outlineScrollRequest?.anchorId).toBe('message-old-answer'));
    expect(screen.getByText('outline.searchMore')).toBeInTheDocument();
  });
  it('restores the stable target after reload and reports deleted or denied targets', async () => {
    state.loadMessageAround.mockRejectedValueOnce(new Error('Not found'));
    render(view('/conversation/conversation?message=deleted'));
    expect(await screen.findByRole('alert')).toHaveTextContent('outline.jumpError');
    expect(useConversationUiStore.getState().outlineScrollRequest).toBeNull();
  });
  it('aborts and ignores an old user search on actor change', async () => {
    let resolve!: (value: unknown) => void;
    search.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const user = userEvent.setup(), mounted = render(view());
    await user.type(screen.getByRole('textbox', { name: 'outline.conversationSearch' }), 'private');
    await user.click(screen.getByRole('button', { name: 'outline.searchConversation' }));
    const signal = search.mock.calls[0][2] as AbortSignal;
    actor.id = 'other'; mounted.rerender(view());
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ matches: [{ messageId: 'private', snippet: 'Private owner result' }], hasMore: false }));
    expect(screen.queryByText('Private owner result')).toBeNull();
  });
});
