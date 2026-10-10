import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { WorkMessageLink } from './WorkMessageLink';
const mocks = vi.hoisted(() => ({ message: vi.fn(), result: vi.fn(), panel: vi.fn(), scroll: vi.fn() }));
vi.mock('../api', () => ({ fetchMessage: mocks.message, fetchRootResult: mocks.result }));
vi.mock('../uiStore', () => ({ useConversationUiStore: (selector: (state: unknown) => unknown) => selector({ setContextPanel: mocks.panel, requestOutlineScroll: mocks.scroll }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => vi.clearAllMocks());
it('loads an original request inline when it is outside the loaded timeline', async () => {
  mocks.message.mockResolvedValue({ content: 'Original request text' });
  render(<WorkMessageLink conversationId='conversation' messageId='old' kind='request' />);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewRequest' }));
  expect(mocks.message).toHaveBeenCalledWith('conversation', 'old');
  expect(await screen.findByText('Original request text')).toBeVisible();
  expect(mocks.panel).not.toHaveBeenCalled();
});
it('loads a committed followup result inline and exposes failures for retry', async () => {
  mocks.result.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ text: 'Full output', complete: true });
  render(<WorkMessageLink conversationId='conversation' messageId='old' executionId='followup' />);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewResult' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewResult' }));
  expect(await screen.findByText('Full output')).toBeVisible();
  expect(mocks.result).toHaveBeenCalledWith('conversation', 'followup');
});
it('navigates loaded messages without refetching', async () => {
  render(<><div id='message-present' /><WorkMessageLink conversationId='conversation' messageId='present' /></>);
  await userEvent.click(screen.getByRole('button', { name: 'rootWork.viewResult' }));
  expect(mocks.scroll).toHaveBeenCalledWith('message-present'); expect(mocks.panel).toHaveBeenCalledWith(null);
  expect(mocks.message).not.toHaveBeenCalled(); expect(mocks.result).not.toHaveBeenCalled();
});
