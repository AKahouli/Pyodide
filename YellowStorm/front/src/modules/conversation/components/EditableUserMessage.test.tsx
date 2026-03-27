import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableUserMessage } from './EditableUserMessage';

const setEditingMessageMock = vi.hoisted(() => vi.fn());
const updateUserMessageMock = vi.hoisted(() => vi.fn());
const regenerateMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ai-elements/mention-popup', () => ({
  MentionPopup: ({ open }: { open: boolean }) => <div>{open ? 'mention-open' : 'mention-closed'}</div>,
}));

vi.mock('@/modules/agent', () => ({
  useAgents: () => [],
  useAgentStore: {
    getState: () => ({ fetchAgents: vi.fn() }),
  },
}));

vi.mock('../store', () => ({
  useConversationStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        updateUserMessage: updateUserMessageMock,
        setEditingMessage: setEditingMessageMock,
        regenerateMessage: regenerateMessageMock,
      }),
    {
      getState: () => ({ messages: [] }),
    },
  ),
}));

describe('EditableUserMessage', () => {
  it('cancels editing', async () => {
    render(
      <EditableUserMessage
        message={{ id: 'm1', content: 'Editable content' } as never}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'actionCancel' }));
    expect(setEditingMessageMock).toHaveBeenCalledWith(null);
  });
});
