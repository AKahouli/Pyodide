import { WidgetSseStreamRegistry } from './widget-sse-stream.registry';

describe('WidgetSseStreamRegistry', () => {
  it('retains the active-run lock when an SSE subscriber disconnects', () => {
    const registry = new WidgetSseStreamRegistry();
    const sessionId = 'session';
    expect(registry.tryStartRun(sessionId)).toBe(true);

    const subscription = registry.observe(sessionId, 60_000).subscribe();
    subscription.unsubscribe();

    expect(registry.tryStartRun(sessionId)).toBe(false);
    registry.finishRun(sessionId);
    expect(registry.tryStartRun(sessionId)).toBe(true);
  });
});
