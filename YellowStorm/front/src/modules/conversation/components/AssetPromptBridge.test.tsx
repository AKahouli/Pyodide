import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetPromptBridge } from './AssetPromptBridge';
import { initialConversationUiState, useConversationUiStore } from '../uiStore';
const setInput = vi.hoisted(() => vi.fn());
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'alice' } }) }));
vi.mock('@/components/ai-elements/prompt-input', () => ({ usePromptInputController: () => ({ textInput: { value: 'Describe this', setInput } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (_key: string, params: { name: string; ref: string }) => `${params.name} [${params.ref}]` }) }));
beforeEach(() => { vi.clearAllMocks(); useConversationUiStore.setState(initialConversationUiState); });
it('adds an explicit exact reference without submitting or replacing the draft', () => {
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c1', 'document:1', 'chart.png'));
  expect(setInput).toHaveBeenCalledWith('Describe this\nchart.png [document:1]\n');
  expect(useConversationUiStore.getState().assetPromptRequest).toBeNull();
});
it('never inserts another user or conversation reference', () => {
  render(<AssetPromptBridge conversationId='c1' />);
  act(() => useConversationUiStore.getState().requestAssetPrompt('bob', 'c1', 'private', 'bob.png'));
  act(() => useConversationUiStore.getState().requestAssetPrompt('alice', 'c2', 'other', 'other.png'));
  expect(setInput).not.toHaveBeenCalled();
});
