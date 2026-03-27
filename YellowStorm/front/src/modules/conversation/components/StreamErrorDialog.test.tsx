import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StreamErrorDialog } from './StreamErrorDialog';

const dismissCriticalErrorMock = vi.hoisted(() => vi.fn());
const dismissSSEErrorMock = vi.hoisted(() => vi.fn());
const retryLastMessageMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const reconnectWithNewTokenMock = vi.hoisted(() => vi.fn());

const stateRef = vi.hoisted(() => ({
  criticalError: null as { code: string; message: string } | null,
  sseError: null as string | null,
}));

vi.mock('../store', () => ({
  useCriticalError: () => stateRef.criticalError,
  useSSEError: () => stateRef.sseError,
  useConversationStore: (selector: (state: { dismissCriticalError: () => void; dismissSSEError: () => void; retryLastMessage: () => Promise<void> }) => unknown) =>
    selector({
      dismissCriticalError: dismissCriticalErrorMock,
      dismissSSEError: dismissSSEErrorMock,
      retryLastMessage: retryLastMessageMock,
    }),
}));

vi.mock('../stream', () => ({
  conversationStreamService: {
    disconnect: disconnectMock,
    reconnectWithNewToken: reconnectWithNewTokenMock,
  },
}));

describe('StreamErrorDialog', () => {
  it('renders nothing when no errors are present', () => {
    stateRef.criticalError = null;
    stateRef.sseError = null;
    const { container } = render(<StreamErrorDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders SSE error state and reconnect action', async () => {
    stateRef.criticalError = null;
    stateRef.sseError = 'Connection lost';

    render(<StreamErrorDialog />);

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'dialogs.streamError.reconnect' }));

    expect(dismissSSEErrorMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
    expect(reconnectWithNewTokenMock).toHaveBeenCalled();
  });
});
