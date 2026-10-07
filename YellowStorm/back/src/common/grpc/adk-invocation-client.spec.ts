import { EventEmitter } from 'node:events';
import { AdkInvocationClient, AdkInvocationError } from './adk-invocation-client';

function call() {
  return Object.assign(new EventEmitter(), {
    cancel: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  });
}

describe('raw ADK invocation transport', () => {
  it('preserves every component and native control frame in order without treating EOF as completion', async () => {
    const stream = call();
    const received: unknown[] = [];
    const frames = [
      { action: 'add', component: { image: { url: 'image' } } },
      { component: { tool_activity: { result_json: '{"value":1}' } } },
      { execution_trace: { lifecycle: 'INVOCATION_LIFECYCLE_WAITING' } },
    ];
    const done = AdkInvocationClient.consume(stream, {
      timeoutMs: 1000,
      onChunk: (chunk) => {
        received.push(chunk);
      },
    });
    frames.forEach((frame) => stream.emit('data', frame));
    stream.emit('end');
    await done;
    expect(received).toEqual(frames);
    expect(received[0]).toBe(frames[0]);
    expect(stream.cancel).not.toHaveBeenCalled();
  });

  it('waits for the asynchronous sink before ending and applies stream backpressure', async () => {
    const stream = call();
    let release: () => void;
    let ended = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = AdkInvocationClient.consume(stream, { timeoutMs: 1000, onChunk: () => gate }).then(
      () => {
        ended = true;
      },
    );
    stream.emit('data', { component: 'full result' });
    stream.emit('end');
    await Promise.resolve();
    expect(ended).toBe(false);
    expect(stream.pause).toHaveBeenCalled();
    release!();
    await done;
    expect(ended).toBe(true);
  });

  it('cancels a timed-out observer once and absorbs the eventual RPC cancellation error', async () => {
    jest.useFakeTimers();
    try {
      const stream = call();
      const done = AdkInvocationClient.consume(stream, { timeoutMs: 10, onChunk: jest.fn() });
      const rejected = expect(done).rejects.toMatchObject({ kind: 'timeout' });
      jest.advanceTimersByTime(11);
      await rejected;
      expect(stream.cancel).toHaveBeenCalledTimes(1);
      expect(() => stream.emit('error', new Error('late cancellation'))).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed when a non-pausing source exceeds the bounded backlog', async () => {
    const stream = call();
    const sink = jest.fn();
    const done = AdkInvocationClient.consume(stream, { timeoutMs: 1000, onChunk: sink });
    const rejected = expect(done).rejects.toBeInstanceOf(AdkInvocationError);
    for (let index = 0; index < 65; index++) stream.emit('data', { index });
    await rejected;
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(sink).not.toHaveBeenCalled();
  });
});
