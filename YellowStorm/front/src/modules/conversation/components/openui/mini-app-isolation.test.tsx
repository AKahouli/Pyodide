import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/modules/auth/AuthContext';
import { useConversationStore } from '../../store';
import type { Message, OpenUiSubmission } from '../../types';
import { OpenUiAnswer } from './OpenUiAnswer';
import { fetchOpenUiAppState } from '../../api';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
vi.mock('../../api', async original => ({ ...await original<typeof import('../../api')>(), fetchOpenUiAppState: vi.fn(), saveOpenUiAppState: vi.fn() }));
vi.mock('./OpenUiRenderer', () => ({ default: ({ initialState }: { initialState: unknown }) => <output data-testid='state'>{JSON.stringify(initialState)}</output> }));
const digest = '0'.repeat(64);
const program = 'root = Card([app])\napp = MiniApp("draft", "Draft", "", [])';
const submitted = (actor: string, state: Record<string, unknown>, programDigest?: string): Message => ({
  id: `submission-${actor}-${programDigest ?? 'legacy'}`, conversationId: 'conversation', senderId: actor,
  conversationType: 'user', createdAt: '2026-10-18T00:00:00Z', interaction: {
    type: 'openui', schemaVersion: 1, sourceMessageId: 'source', componentId: 'part', formName: 'draft',
    actionType: 'continue_conversation', formState: state,
    ...(programDigest ? { appTask: { schemaVersion: 1, programDigest, stateRevision: 1, documentIds: [] } } : {}),
  } as OpenUiSubmission,
});
const mount = () => render(<AuthContext.Provider value={{ user: { id: 'actor-a' } } as never}>
  <OpenUiAnswer content={program} isStreaming={false} conversationId='conversation' messageId='source' partId='part' />
</AuthContext.Provider>);

describe('mini-app accepted-submission fallback isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) } });
    vi.mocked(fetchOpenUiAppState).mockResolvedValue({ schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest: digest,
      stateRevision: 0, state: {}, updatedAt: null });
    useConversationStore.setState({ messages: [], currentConversationId: 'conversation', isStreaming: false });
  });

  it('keeps same-user legacy hydration but never imports another participant’s accepted values', async () => {
    const own = { $amount: 0, $enabled: false, $blank: '', $optional: null };
    useConversationStore.setState({ messages: [submitted('actor-a', own), submitted('actor-b', { $amount: 900, $source: 'other participant' })] });
    mount();
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual(own));
  });

  it('does not hydrate a replaced program from its older accepted task state', async () => {
    useConversationStore.setState({ messages: [submitted('actor-a', { $source: 'old program' }, 'f'.repeat(64))] });
    mount();
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({}));
  });

  it('restores matching own-program accepted values when no private draft exists', async () => {
    const state = { $document: '1'.repeat(24), $length: 'short' };
    useConversationStore.setState({ messages: [submitted('actor-a', state, digest)] });
    mount();
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual(state));
  });
});
