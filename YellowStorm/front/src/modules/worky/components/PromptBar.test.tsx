import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { PromptBar } from './PromptBar';
import { useWorkyUiStore } from '../uiStore';

const STREAM_ID = 'stream-1';
interface SendInput {
  content: string;
  turnId: string;
  managerModelId?: string;
  workerModelId?: string;
}
interface SendCallbacks {
  onSuccess?: () => void;
  onError?: (e: unknown) => void;
}
const sendCalls: SendInput[] = [];
let nextError: Error | null = null;
let lastMutate: ((input: SendInput, callbacks?: SendCallbacks) => void) | null = null;
// The composer swaps the send button for a stop button while a run streams.
// Tests flip this to render/exercise that path.
let streamingValue = false;
const stopMutateMock = vi.fn();

vi.mock('../query/hooks', () => ({
  useSendMessage: () => ({
    mutate: (input: SendInput, callbacks?: SendCallbacks) => {
      lastMutate = (i, c) => {
        sendCalls.push(i);
        if (nextError) {
          const err = nextError;
          nextError = null;
          c?.onError?.(err);
          return;
        }
        c?.onSuccess?.();
      };
      lastMutate(input, callbacks);
    },
    isPending: false,
  }),
  // Consumed by useStopSession (via PromptBar). Capture the stop request.
  useStopTurn: () => ({ mutate: stopMutateMock, isPending: false }),
  useStream: () => ({ data: undefined }),
}));

vi.mock('../store', () => ({
  useWorkyStreaming: () => streamingValue,
  useWorkyStore: (selector: (s: {
    setStreamError: (v: string | null) => void;
    beginTurn: (turnId: string) => void;
    finishTurn: (turnId: string) => void;
  }) => unknown) =>
    selector({
      setStreamError: setStreamErrorMock,
      beginTurn: beginTurnMock,
      finishTurn: finishTurnMock,
    }),
}));

const setStreamErrorMock = vi.fn();
const beginTurnMock = vi.fn();
const finishTurnMock = vi.fn();

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}

describe('PromptBar composer', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    lastMutate = null;
    nextError = null;
    streamingValue = false;
    stopMutateMock.mockClear();
    setStreamErrorMock.mockClear();
    beginTurnMock.mockClear();
    finishTurnMock.mockClear();
    useWorkyUiStore.getState().reset();
  });

  it('submits content with no per-turn model override payload', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toEqual({ content: 'hello', turnId: expect.any(String) });
    expect(sendCalls[0].managerModelId).toBeUndefined();
    expect(sendCalls[0].workerModelId).toBeUndefined();
  });

  it('does not render inline model selectors (per-turn UI removed)', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );
    expect(screen.queryByTestId(/^worky-model-selector-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^worky-model-default-/)).not.toBeInTheDocument();
  });

  it('allows sending when the stream is stopped', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='stopped' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'do not send' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(textarea).not.toBeDisabled();
    expect(sendCalls).toHaveLength(1);
  });

  it('sets manager-working state while a message is sent', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'show progress' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(beginTurnMock).toHaveBeenCalledWith(sendCalls[0].turnId);
  });

  it('clears any prior stream error when a new message is sent', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'retry' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    expect(setStreamErrorMock).toHaveBeenCalledWith(null);
  });

  it('surfaces a send-failure alert and clears it on stream switch', async () => {
    nextError = new Error('Network exploded');

    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'oops' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));

    const alert = await screen.findByTestId('worky-send-error');
    expect(alert).toHaveTextContent('Network exploded');
    expect(finishTurnMock).toHaveBeenCalledWith(sendCalls[0].turnId);

    // Stream switch must clear the failure so it never bleeds across.
    const { rerender } = render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );
    rerender(
      <TestProviders>
        <PromptBar streamId='other-stream' status='active' />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('worky-send-error')).not.toBeInTheDocument();
    });
  });

  it('keeps send available while streaming so the active plan can be amended', () => {
    streamingValue = true;
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );

    const textarea = screen.getByTestId('worky-prompt-content');
    fireEvent.change(textarea, { target: { value: 'add a follow-up' } });
    fireEvent.click(screen.getByTestId('worky-prompt-send'));
    expect(sendCalls[0]).toMatchObject({ content: 'add a follow-up' });
    expect(screen.queryByTestId('worky-prompt-stop')).not.toBeInTheDocument();
  });

  it('disables message submission while the Companion session is paused', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' sessionStatus='paused' />
      </TestProviders>,
    );
    expect(screen.getByTestId('worky-prompt-content')).toBeDisabled();
    expect(screen.getByTestId('worky-prompt-send')).toBeDisabled();
  });

  it('does not render the removed in-composer dictation mic', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='active' />
      </TestProviders>,
    );
    expect(screen.queryByTestId('worky-prompt-mic')).not.toBeInTheDocument();
  });

  it('shows WhatsApp button and calls onWhatsAppClick', () => {
    const onWhatsAppClick = vi.fn();
    render(
      <TestProviders>
        <PromptBar
          streamId={STREAM_ID}
          status='active'
          onWhatsAppClick={onWhatsAppClick}
          whatsappConnected
        />
      </TestProviders>,
    );

    fireEvent.click(screen.getByTestId('worky-prompt-whatsapp'));
    expect(onWhatsAppClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('worky-prompt-whatsapp-connected')).toBeInTheDocument();
  });

  it('disables WhatsApp button when stream is archived', () => {
    render(
      <TestProviders>
        <PromptBar streamId={STREAM_ID} status='archived' onWhatsAppClick={vi.fn()} />
      </TestProviders>,
    );

    expect(screen.getByTestId('worky-prompt-whatsapp')).toBeDisabled();
  });
});
