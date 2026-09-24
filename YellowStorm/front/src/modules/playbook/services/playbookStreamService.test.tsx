import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePlaybookStreamGlobal } from './playbookStreamService';

const store = vi.hoisted(() => ({
  onExecutionStart: vi.fn(),
  onStepStart: vi.fn(),
  onStepUpdate: vi.fn(),
  onStepComplete: vi.fn(),
  onIteratorChildStepStart: vi.fn(),
  onIteratorChildStepUpdate: vi.fn(),
  onIteratorChildStepComplete: vi.fn(),
  onExecutionComplete: vi.fn(),
  onInterrupt: vi.fn(),
  fetchPlaybooks: vi.fn(),
  hydrateActiveExecutions: vi.fn(),
}));

const features = vi.hoisted(() => ({
  querySseEnabled: false,
  querySseMirrorZustandEnabled: false,
  xstateExecutionEnabled: false,
}));

vi.mock('../store', () => ({
  usePlaybookStore: { getState: () => store },
}));

vi.mock('../features', () => ({ playbookFeatures: features }));

vi.mock('../api', () => ({
  getActiveExecutions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/config', () => ({
  API_CONFIG: { baseURL: 'http://api.local' },
  AUTH_STORAGE_KEYS: { accessToken: 'token-key' },
  API_ENDPOINTS: { playbooks: { stream: '/playbook/stream' } },
}));

class EventSourceMock {
  static instances: EventSourceMock[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(public url: string) { EventSourceMock.instances.push(this); }
  addEventListener = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  });
  close = vi.fn();
}

class BroadcastChannelMock {
  static instances: BroadcastChannelMock[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  constructor(public name: string) { BroadcastChannelMock.instances.push(this); }
}

describe('playbookStreamService (BroadcastChannel leader election)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    EventSourceMock.instances = [];
    BroadcastChannelMock.instances = [];
    features.querySseEnabled = false;
    features.querySseMirrorZustandEnabled = false;
    vi.stubGlobal('EventSource', EventSourceMock as unknown as typeof EventSource);
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock as unknown as typeof BroadcastChannel);
    localStorage.setItem('token-key', 'abc');
  });

  afterEach(() => { vi.useRealTimers(); });

  it('becomes leader when no other tab responds, opens EventSource, and routes events', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    // Should have created a BroadcastChannel
    expect(BroadcastChannelMock.instances).toHaveLength(1);
    // No EventSource yet — waiting for leader check
    expect(EventSourceMock.instances).toHaveLength(0);

    // Advance past leader check wait (200ms)
    act(() => { vi.advanceTimersByTime(250); });

    // Now should be leader with an EventSource
    expect(EventSourceMock.instances).toHaveLength(1);
    const es = EventSourceMock.instances[0];
    expect(es.url).toContain('/playbook/stream?token=abc');

    // Simulate named SSE event — should handle locally and broadcast to followers
    const bc = BroadcastChannelMock.instances[0];
    es.listeners.get('playbook_execution_complete')?.[0]?.({
      data: JSON.stringify({ executionId: 'e1' }),
    } as MessageEvent);

    expect(store.onExecutionComplete).toHaveBeenCalledWith({ executionId: 'e1' });
    expect(bc.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sse-event' }),
    );

    unmount();
    expect(es.close).toHaveBeenCalled();
    expect(bc.close).toHaveBeenCalled();
  });

  it('notifies the open console when a playbook is shared with the user', () => {
    features.querySseEnabled = true;
    const listener = vi.fn();
    window.addEventListener('yellowstorm:playbook-shared', listener);
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());
    act(() => { vi.advanceTimersByTime(250); });
    EventSourceMock.instances[0].listeners.get('playbook_shared')?.[0]?.({
      data: JSON.stringify({ playbookId: 'flow-1' }),
    } as MessageEvent);

    expect(store.fetchPlaybooks).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();

    window.removeEventListener('yellowstorm:playbook-shared', listener);
    unmount();
  });

  it('notifies a follower console when the leader relays a shared playbook', () => {
    features.querySseEnabled = true;
    const listener = vi.fn();
    window.addEventListener('yellowstorm:playbook-shared', listener);
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());
    const bc = BroadcastChannelMock.instances[0];
    const leaderListener = bc.addEventListener.mock.calls.find((call: any[]) => call[0] === 'message')?.[1];
    leaderListener?.({ data: { type: 'leader-alive', tabId: 'other' } });
    act(() => { vi.advanceTimersByTime(250); });

    bc.onmessage?.({
      data: {
        type: 'sse-event',
        payload: JSON.stringify({ type: 'playbook_shared', data: { playbookId: 'flow-1' } }),
      },
    } as MessageEvent);

    expect(store.fetchPlaybooks).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();

    window.removeEventListener('yellowstorm:playbook-shared', listener);
    unmount();
  });

  it('becomes follower when a leader responds to check', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());
    const bc = BroadcastChannelMock.instances[0];

    // Simulate a leader responding during the check window
    // The service adds a one-shot listener via addEventListener
    const addListenerCall = bc.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'message',
    );
    if (addListenerCall) {
      const listener = addListenerCall[1];
      listener({ data: { type: 'leader-alive', tabId: 'other-tab' } });
    }

    act(() => { vi.advanceTimersByTime(250); });

    // Should NOT have created an EventSource (follower mode)
    expect(EventSourceMock.instances).toHaveLength(0);

    unmount();
  });

  it('follower handles relayed SSE events from leader', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());
    const bc = BroadcastChannelMock.instances[0];

    // Make it a follower by simulating leader response
    const addListenerCall = bc.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'message',
    );
    if (addListenerCall) {
      addListenerCall[1]({ data: { type: 'leader-alive', tabId: 'other' } });
    }
    act(() => { vi.advanceTimersByTime(250); });

    // Simulate relayed event from leader via BroadcastChannel
    bc.onmessage?.({
      data: {
        type: 'sse-event',
        payload: JSON.stringify({ type: 'playbook_step_start', data: { executionId: 'e2', taskId: 't1' } }),
      },
    } as MessageEvent);

    expect(store.onStepStart).toHaveBeenCalledWith({ executionId: 'e2', taskId: 't1' });

    unmount();
  });

  it('hydrates empty active execution lists on reconnect and follower state sync', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    act(() => { vi.advanceTimersByTime(250); });

    const es = EventSourceMock.instances[0];
    const connectedListener = es.listeners.get('playbook_connected')?.[0];
    connectedListener?.({
      data: JSON.stringify({ connectionId: 'c1', activeExecutions: [] }),
    } as MessageEvent);

    expect(store.hydrateActiveExecutions).toHaveBeenCalledWith([]);

    const bc = BroadcastChannelMock.instances[0];
    bc.onmessage?.({ data: { type: 'state-response', activeExecutions: [] } } as MessageEvent);

    expect(store.hydrateActiveExecutions).toHaveBeenLastCalledWith([]);

    unmount();
  });

  it('hydrates replay execution modes from connected events', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    act(() => { vi.advanceTimersByTime(250); });

    const es = EventSourceMock.instances[0];
    const connectedListener = es.listeners.get('playbook_connected')?.[0];
    connectedListener?.({
      data: JSON.stringify({
        connectionId: 'c1',
        activeExecutions: [
          {
            id: 'exec-1',
            playbookId: 'playbook-1',
            status: 'running',
            executionMode: 'inherit',
            stepExecutionModes: { 'task-1': 'replay_flex' },
            taskResults: [],
          },
        ],
      }),
    } as MessageEvent);

    expect(store.hydrateActiveExecutions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'exec-1',
        executionMode: 'inherit',
        stepExecutionModes: { 'task-1': 'replay_flex' },
      }),
    ]);

    unmount();
  });

  it('shares pending-approval executions with follower tabs', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    act(() => { vi.advanceTimersByTime(250); });

    const bc = BroadcastChannelMock.instances[0];
    (store as any).executionCache = {
      'exec-pending': {
        id: 'exec-pending',
        status: 'pending_approval',
      },
      'exec-complete': {
        id: 'exec-complete',
        status: 'completed',
      },
    };

    bc.onmessage?.({ data: { type: 'state-request' } } as MessageEvent);

    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'state-response',
      activeExecutions: [{ id: 'exec-pending', status: 'pending_approval' }],
    });

    unmount();
  });

  it('batches rapid step updates and only applies the latest payload per step', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    act(() => { vi.advanceTimersByTime(250); });

    const es = EventSourceMock.instances[0];
    const stepUpdateListener = es.listeners.get('playbook_step_update')?.[0];
    expect(stepUpdateListener).toBeDefined();

    act(() => {
      stepUpdateListener?.({
        data: JSON.stringify({ executionId: 'e1', taskId: 't1', output: 'hel' }),
      } as MessageEvent);
      stepUpdateListener?.({
        data: JSON.stringify({ executionId: 'e1', taskId: 't1', output: 'hello' }),
      } as MessageEvent);
    });

    expect(store.onStepUpdate).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(32); });

    expect(store.onStepUpdate).toHaveBeenCalledTimes(1);
    expect(store.onStepUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'e1', taskId: 't1', output: 'hello' }),
    );

    unmount();
  });

  it('flushes pending step updates before step completion events', () => {
    const { unmount } = renderHook(() => usePlaybookStreamGlobal());

    act(() => { vi.advanceTimersByTime(250); });

    const es = EventSourceMock.instances[0];
    const stepUpdateListener = es.listeners.get('playbook_step_update')?.[0];
    const stepCompleteListener = es.listeners.get('playbook_step_complete')?.[0];

    act(() => {
      stepUpdateListener?.({
        data: JSON.stringify({ executionId: 'e1', taskId: 't1', output: 'hello' }),
      } as MessageEvent);
    });

    expect(store.onStepUpdate).not.toHaveBeenCalled();

    act(() => {
      stepCompleteListener?.({
        data: JSON.stringify({ executionId: 'e1', taskId: 't1', status: 'completed' }),
      } as MessageEvent);
    });

    expect(store.onStepUpdate).toHaveBeenCalledTimes(1);
    expect(store.onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'e1', taskId: 't1', status: 'completed' }),
    );

    unmount();
  });
});
