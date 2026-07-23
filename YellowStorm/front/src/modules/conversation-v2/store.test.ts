import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConversationV2Store } from './store';
import { conversationV2Api } from './api';

describe('useConversationV2Store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConversationV2Store.getState().reset();
  });

  it('handleEvent("message") appends a bubble', () => {
    const { handleEvent, events } = useConversationV2Store.getState();
    expect(events).toEqual([]);
    handleEvent({ type: 'message', event_id: 'e1', timestamp: 1, role: 'assistant', content: 'hi' });
    expect(useConversationV2Store.getState().events).toHaveLength(1);
  });

  it('handleEvent("tool") upserts by tool_call_id', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({ type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 't1', name: 'shell', status: 'running', function: 'run', args: {} });
    handleEvent({ type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 't1', name: 'shell', status: 'success', function: 'run', args: {} });
    const tools = useConversationV2Store.getState().events.filter((e) => e.type === 'tool');
    expect(tools).toHaveLength(1);
    expect((tools[0] as any).status).toBe('success');
  });

  it('handleEvent("step") upserts by id', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({ type: 'step', event_id: 'e1', timestamp: 1, id: 's1', status: 'running', description: 'do x' });
    handleEvent({ type: 'step', event_id: 'e2', timestamp: 2, id: 's1', status: 'success', description: 'do x' });
    const steps = useConversationV2Store.getState().events.filter((e) => e.type === 'step');
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).status).toBe('success');
  });

  it('handleEvent("title") sets title without inserting an event', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({ type: 'title', event_id: 'e1', timestamp: 1, title: 'New' });
    expect(useConversationV2Store.getState().title).toBe('New');
    expect(useConversationV2Store.getState().events).toHaveLength(0);
  });

  it('handleEvent("done") clears streaming flag', () => {
    const { handleEvent, setStreaming } = useConversationV2Store.getState();
    setStreaming(true);
    handleEvent({ type: 'done', event_id: 'e1', timestamp: 1 });
    expect(useConversationV2Store.getState().streaming).toBe(false);
  });

  it('handleEvent("error") sets streamError and clears streaming', () => {
    const { handleEvent, setStreaming } = useConversationV2Store.getState();
    setStreaming(true);
    handleEvent({ type: 'error', event_id: 'e1', timestamp: 1, error: 'boom' });
    expect(useConversationV2Store.getState().streamError).toBe('boom');
    expect(useConversationV2Store.getState().streaming).toBe(false);
  });

  it('handleEvent("tool") auto-follows live for non-message tools', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'browser', status: 'calling', function: 'browser_navigate', args: { url: 'x' },
    });
    expect(useConversationV2Store.getState().liveToolCallId).toBe('tc1');
    expect(useConversationV2Store.getState().selectedToolCallId).toBe('tc1');
    expect(useConversationV2Store.getState().rightPanelMode).toBe('tool');

    handleEvent({
      type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 'tc2',
      name: 'search', status: 'calling', function: 'info_search_web', args: { query: 'q' },
    });
    expect(useConversationV2Store.getState().liveToolCallId).toBe('tc2');
    expect(useConversationV2Store.getState().selectedToolCallId).toBe('tc2');
  });

  it('handleEvent("tool") does not change selection when user is viewing a past tool', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'browser', status: 'calling', function: 'browser_navigate', args: {},
    });
    // User clicks a past tool.
    useConversationV2Store.setState({ selectedToolCallId: 'old' });
    handleEvent({
      type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 'tc2',
      name: 'search', status: 'calling', function: 'info_search_web', args: {},
    });
    expect(useConversationV2Store.getState().liveToolCallId).toBe('tc2');
    expect(useConversationV2Store.getState().selectedToolCallId).toBe('old');
  });

  it('handleEvent("tool") ignores message tools for live tracking', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'message', status: 'calling', function: 'message_notify_user', args: { text: 'hi' },
    });
    expect(useConversationV2Store.getState().liveToolCallId).toBeNull();
    expect(useConversationV2Store.getState().rightPanelMode).toBe('closed');
  });

  it('handleEvent("done") clears liveToolCallId', () => {
    const { handleEvent } = useConversationV2Store.getState();
    useConversationV2Store.setState({ liveToolCallId: 'tc1', streaming: true });
    handleEvent({ type: 'done', event_id: 'e1', timestamp: 1 });
    expect(useConversationV2Store.getState().liveToolCallId).toBeNull();
  });

  it('jumpToLive selects the live tool', () => {
    useConversationV2Store.setState({ liveToolCallId: 'live', selectedToolCallId: 'old', rightPanelMode: 'tool' });
    useConversationV2Store.getState().jumpToLive();
    expect(useConversationV2Store.getState().selectedToolCallId).toBe('live');
  });

  it('replayEvents keeps per-turn step/tool entries separate when ids repeat', () => {
    const { replayEvents } = useConversationV2Store.getState();
    replayEvents([
      { type: 'message', event_id: 'u1', timestamp: 0, role: 'user', content: 'first' },
      { type: 'step', event_id: 's1a', timestamp: 1, id: '1', status: 'running', description: 'do' },
      { type: 'tool', event_id: 't1a', timestamp: 2, tool_call_id: 'tc1', name: 'search', status: 'calling', function: 'info_search_web', args: {} },
      { type: 'tool', event_id: 't1b', timestamp: 3, tool_call_id: 'tc1', name: 'search', status: 'called', function: 'info_search_web', args: {}, content: { kind: 'search', query: 'q', results: [] } },
      { type: 'step', event_id: 's1b', timestamp: 4, id: '1', status: 'completed', description: 'do' },
      { type: 'done', event_id: 'd1', timestamp: 5 },
      { type: 'message', event_id: 'u2', timestamp: 6, role: 'user', content: 'again' },
      { type: 'step', event_id: 's2a', timestamp: 7, id: '1', status: 'running', description: 'redo' },
      { type: 'tool', event_id: 't2a', timestamp: 8, tool_call_id: 'tc1', name: 'search', status: 'calling', function: 'info_search_web', args: {} },
    ]);
    const evs = useConversationV2Store.getState().events;
    const steps = evs.filter((e) => e.type === 'step');
    const tools = evs.filter((e) => e.type === 'tool');
    expect(steps).toHaveLength(2);
    expect(tools).toHaveLength(2);
  });

  it('replayEvents collapses duplicate tool/step/plan records', () => {
    const { replayEvents } = useConversationV2Store.getState();
    replayEvents([
      { type: 'message', event_id: 'm1', timestamp: 0, role: 'user', content: 'hi' },
      { type: 'tool', event_id: 't1a', timestamp: 1, tool_call_id: 'tc1', name: 'search', status: 'calling', function: 'q', args: {} },
      { type: 'tool', event_id: 't1b', timestamp: 2, tool_call_id: 'tc1', name: 'search', status: 'called', function: 'q', args: {}, content: { kind: 'search', query: 'q', results: [] } },
      { type: 'step', event_id: 's1a', timestamp: 3, id: 'step1', status: 'running', description: 'do' },
      { type: 'step', event_id: 's1b', timestamp: 4, id: 'step1', status: 'completed', description: 'do' },
      { type: 'plan', event_id: 'p1', timestamp: 5, steps: [{ id: 'step1', status: 'completed', description: 'do' }] },
      { type: 'plan', event_id: 'p2', timestamp: 6, steps: [{ id: 'step1', status: 'completed', description: 'do' }, { id: 'step2', status: 'pending', description: 'next' }] },
    ]);
    const evs = useConversationV2Store.getState().events;
    const tools = evs.filter((e) => e.type === 'tool');
    const steps = evs.filter((e) => e.type === 'step');
    const plans = evs.filter((e) => e.type === 'plan');
    expect(tools).toHaveLength(1);
    expect((tools[0] as any).status).toBe('called');
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).status).toBe('completed');
    expect(plans).toHaveLength(1);
    expect((plans[0] as any).event_id).toBe('p2');
  });

  it('handleEvent scopes tool/step upserts to the current turn', () => {
    const { handleEvent } = useConversationV2Store.getState();
    handleEvent({ type: 'message', event_id: 'u1', timestamp: 1, role: 'user', content: 'first' });
    handleEvent({ type: 'step', event_id: 's1a', timestamp: 2, id: '1', status: 'running', description: 'do' });
    handleEvent({
      type: 'tool', event_id: 't1a', timestamp: 3, tool_call_id: 'tc1', name: 'search',
      status: 'calling', function: 'info_search_web', args: {},
    });
    handleEvent({ type: 'step', event_id: 's1b', timestamp: 4, id: '1', status: 'completed', description: 'do' });
    handleEvent({ type: 'done', event_id: 'd1', timestamp: 5 });

    handleEvent({ type: 'message', event_id: 'u2', timestamp: 6, role: 'user', content: 'second' });
    handleEvent({ type: 'step', event_id: 's2a', timestamp: 7, id: '1', status: 'running', description: 'redo' });
    handleEvent({
      type: 'tool', event_id: 't2a', timestamp: 8, tool_call_id: 'tc1', name: 'search',
      status: 'calling', function: 'info_search_web', args: {},
    });

    const evs = useConversationV2Store.getState().events;
    const steps = evs.filter((e) => e.type === 'step');
    const tools = evs.filter((e) => e.type === 'tool');
    // Two separate steps and two separate tools, one per turn.
    expect(steps).toHaveLength(2);
    expect(steps.map((s: any) => s.event_id)).toEqual(['s1b', 's2a']);
    expect(tools).toHaveLength(2);
    expect(tools.map((t: any) => t.event_id)).toEqual(['t1a', 't2a']);
  });

  it('replayEvents replaces events wholesale', () => {
    const { handleEvent, replayEvents } = useConversationV2Store.getState();
    handleEvent({ type: 'message', event_id: 'e1', timestamp: 1, role: 'assistant', content: 'a' });
    replayEvents([
      { type: 'message', event_id: 'r1', timestamp: 0, role: 'assistant', content: 'replay' },
    ]);
    const evs = useConversationV2Store.getState().events;
    expect(evs).toHaveLength(1);
    expect((evs[0] as any).event_id).toBe('r1');
  });

  it('setDeployState replaces the active application preview URL', () => {
    useConversationV2Store.getState().handleEvent({
      type: 'application_component',
      event_id: 'app-1',
      timestamp: 1,
      title: 'Generated app',
      url: 'https://preview.example/app',
    });

    useConversationV2Store.getState().setDeployState({
      deployStatus: 'deployed',
      deployedUrl: 'https://deployed.example/app',
    });

    expect(useConversationV2Store.getState().applicationComponent).toEqual({
      title: 'Generated app',
      url: 'https://deployed.example/app',
    });
  });

  it('deploy sends the application component title to the backend', async () => {
    const deploySpy = vi.spyOn(conversationV2Api, 'deploySession').mockResolvedValueOnce({
      deployStatus: 'deployed',
      deployedUrl: 'https://deployed.example/app',
      lastDeployedAt: '2026-07-17T10:00:00.000Z',
    });
    useConversationV2Store.setState({
      sessionId: 'session-1',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
      },
    });

    await useConversationV2Store.getState().deploy();

    expect(deploySpy).toHaveBeenCalledWith('session-1', 'Generated app');
    expect(useConversationV2Store.getState().lastDeployedAt).toBe(
      '2026-07-17T10:00:00.000Z',
    );
  });

  it('replayEvents restores the deployed URL over the original preview URL', () => {
    useConversationV2Store.setState({
      deployedUrl: 'https://deployed.example/app',
      deployStatus: 'deployed',
    });

    useConversationV2Store.getState().replayEvents([
      {
        type: 'application_component',
        event_id: 'app-1',
        timestamp: 1,
        title: 'Generated app',
        url: 'https://preview.example/app',
      },
    ]);

    expect(useConversationV2Store.getState().applicationComponent?.url).toBe(
      'https://deployed.example/app',
    );
  });
});
