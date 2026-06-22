import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToStreamEvents } from './sse';

const config = {
  baseURL: 'http://api.test',
  getAccessToken: () => 'token-1',
};

function okStreamResponse(): Response {
  return new Response(new ReadableStream(), { status: 200 });
}

function sseResponse(frame: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('subscribeToStreamEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries retryable non-ok responses with rebuilt auth headers', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(okStreamResponse());
    const onEvent = vi.fn();

    const unsubscribe = subscribeToStreamEvents('stream-1', onEvent, config);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://api.test/worky/streams/stream-1/events',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    unsubscribe();
  });

  it('does not retry permanent auth failures', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }));
    const onEvent = vi.fn();

    subscribeToStreamEvents('stream-1', onEvent, config);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'stream.terminal',
      data: { error: true, source: 'sse-non-ok', status: 401 },
    });
  });

  it('surfaces server error frames without reconnecting', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(sseResponse('event: error\ndata: {"code":"WORKY_SSE_LIMIT"}\n\n'));
    const onEvent = vi.fn();

    subscribeToStreamEvents('stream-1', onEvent, config);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({
      type: 'stream.terminal',
      data: { error: true, source: 'sse-error-frame', code: 'WORKY_SSE_LIMIT' },
    }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending retry on unsubscribe', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));

    const unsubscribe = subscribeToStreamEvents('stream-1', vi.fn(), config);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('emits one terminal error after retry exhaustion', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    const onEvent = vi.fn();

    subscribeToStreamEvents('stream-1', onEvent, config);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    let expectedCalls = 1;
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay);
      expectedCalls += 1;
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls));
    }

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'stream.terminal',
      data: { source: 'sse-non-ok', status: 503, error: true },
    });
  });
});
