import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetPromptBridge } from './AssetPromptBridge';
import { initialConversationUiState, useConversationUiStore } from '../uiStore';
const auth = vi.hoisted(() => ({ actor: 'alice' }));
const draft = vi.hoisted(() => ({ value: '', setInput: vi.fn() }));
vi.mock('@/components/ai-elements/prompt-input', () => ({ usePromptInputController: () => ({ textInput: draft }) }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: auth.actor } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, params?: { name?: string }) => params?.name ? `${key} ${params.name}` : key }) }));
beforeEach(() => { vi.clearAllMocks(); auth.actor = 'alice'; draft.value = ''; useConversationUiStore.setState(initialConversationUiState); });
it('refines an exact source by preserving the current draft and adding a selected chip without submitting', () => {
  draft.value = 'Keep my existing request';
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'exact-source', 'Dashboard', 'refine', 'answer-1'));
  expect(draft.setInput).toHaveBeenCalledWith('Keep my existing request\n\nassets.refinePrompt');
  expect(useConversationUiStore.getState().selectedAssets?.items[0]).toMatchObject({ ref: 'exact-source', name: 'Dashboard', sourceMessageId: 'answer-1' });
  expect(screen.queryByText('exact-source')).toBeNull();
});
it('does not alter the draft for a foreign refine request or a selection beyond the limit', () => {
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('bob', 'c1', 'foreign', 'Foreign', 'refine'));
  expect(draft.setInput).not.toHaveBeenCalled();
  act(() => { for (let i = 0; i < 8; i++) useConversationUiStore.getState().addAssetSelection('alice', 'c1', `ref-${i}`, 'same.pdf'); });
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'ninth', 'Extra', 'refine'));
  expect(draft.setInput).not.toHaveBeenCalled();
});
it('shows a readable removable chip while keeping its exact ref out of the draft UI', () => {
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'opaque-private-ref', 'chart.png'));
  expect(screen.getByText('chart.png')).toHaveAttribute('title', 'chart.png');
  expect(screen.queryByText(/opaque-private-ref/)).toBeNull();
  expect(useConversationUiStore.getState().selectedAssets?.items[0].ref).toBe('opaque-private-ref');
  expect(useConversationUiStore.getState().assetPromptRequest).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'assets.removeSelection chart.png' }));
  expect(screen.queryByText('chart.png')).toBeNull();
});
it('deduplicates exact refs, preserves same-name distinct files and bounds selection', () => {
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => { for (let i = 0; i < 8; i++) useConversationUiStore.getState().addAssetSelection('alice', 'c1', `ref-${i}`, 'same.pdf'); });
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'ref-0', 'same.pdf'));
  expect(screen.getAllByText('same.pdf')).toHaveLength(8);
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'ninth', 'extra.pdf'));
  expect(screen.getByRole('status')).toHaveTextContent('assets.selectionLimit');
  expect(screen.queryByText('extra.pdf')).toBeNull();
});
it('never shows another actor or conversation selection and clears scope on switching', () => {
  const view = render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('bob', 'c1', 'private', 'bob.png'));
  expect(screen.queryByText('bob.png')).toBeNull();
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'mine', 'alice.png'));
  expect(screen.getByText('alice.png')).toBeInTheDocument();
  auth.actor = 'bob';
  view.rerender(<AssetPromptBridge conversationId='c2' />);
  expect(screen.queryByText('alice.png')).toBeNull();
  expect(useConversationUiStore.getState().selectedAssets).toMatchObject({ actorId: 'bob', conversationId: 'c2', items: [] });
});
