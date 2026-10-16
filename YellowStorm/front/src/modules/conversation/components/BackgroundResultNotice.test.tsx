import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BackgroundResultNotice } from './BackgroundResultNotice';
import { initialRootWorkState, useRootWorkStore } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';

let atBottom = false;
vi.mock('use-stick-to-bottom', () => ({ useStickToBottomContext: () => ({ isAtBottom: atBottom }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  atBottom = false;
  useRootWorkStore.setState({ ...initialRootWorkState, unreadPublicationIds: { conversation: ['result'] } });
});
it('offers a result jump while reading history without marking the result read', () => {
  render(<><div id='message-result' /><BackgroundResultNotice conversationId='conversation' /></>);
  fireEvent.click(screen.getByRole('button'));
  expect(useConversationUiStore.getState().outlineScrollRequest?.anchorId).toBe('message-result');
  expect(useRootWorkStore.getState().unreadPublicationIds.conversation).toEqual(['result']);
});
it('stays out of the way when following the bottom', () => {
  atBottom = true;
  render(<BackgroundResultNotice conversationId='conversation' />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
