import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { useAppBuilderStudioStore } from './store';
import { appBuilderStudioApi } from './api';
import type { AgentEvent } from './types';

describe('useAppBuilderStudioStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppBuilderStudioStore.getState().reset();
    useAppBuilderStudioStore.setState({ streamingStateCache: new Map() });
  });

  it('handleEvent("message") appends a bubble', () => {
    const { handleEvent, events } = useAppBuilderStudioStore.getState();
    expect(events).toEqual([]);
    handleEvent({ type: 'message', event_id: 'e1', timestamp: 1, role: 'assistant', content: 'hi' });
    expect(useAppBuilderStudioStore.getState().events).toHaveLength(1);
  });

  it('handleEvent("tool") upserts by tool_call_id', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({ type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 't1', name: 'shell', status: 'running', function: 'run', args: {} });
    handleEvent({ type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 't1', name: 'shell', status: 'success', function: 'run', args: {} });
    const tools = useAppBuilderStudioStore.getState().events.filter((e) => e.type === 'tool');
    expect(tools).toHaveLength(1);
    expect((tools[0] as any).status).toBe('success');
  });

  it('handleEvent("step") upserts by id', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({ type: 'step', event_id: 'e1', timestamp: 1, id: 's1', status: 'running', description: 'do x' });
    handleEvent({ type: 'step', event_id: 'e2', timestamp: 2, id: 's1', status: 'success', description: 'do x' });
    const steps = useAppBuilderStudioStore.getState().events.filter((e) => e.type === 'step');
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).status).toBe('success');
  });

  it('handleEvent("title") sets title without inserting an event', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({ type: 'title', event_id: 'e1', timestamp: 1, title: 'New' });
    expect(useAppBuilderStudioStore.getState().title).toBe('New');
    expect(useAppBuilderStudioStore.getState().events).toHaveLength(0);
  });

  it('handleEvent("done") clears streaming flag', () => {
    const { handleEvent, setStreaming } = useAppBuilderStudioStore.getState();
    setStreaming(true);
    handleEvent({ type: 'done', event_id: 'e1', timestamp: 1 });
    expect(useAppBuilderStudioStore.getState().streaming).toBe(false);
  });

  it('handleEvent("done") marks in-flight tools as called', () => {
    const { handleEvent, setStreaming } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'message',
      event_id: 'u1',
      timestamp: 1,
      role: 'user',
      content: 'build',
    });
    handleEvent({
      type: 'tool',
      event_id: 't1',
      timestamp: 2,
      tool_call_id: 'tc1',
      name: 'mcp',
      status: 'calling',
      function: 'yellowruntime_write',
      args: {},
    });
    setStreaming(true);
    handleEvent({ type: 'done', event_id: 'd1', timestamp: 3 });
    const tool = useAppBuilderStudioStore
      .getState()
      .events.find((e) => e.type === 'tool' && e.tool_call_id === 'tc1');
    expect(tool?.type === 'tool' ? tool.status : null).toBe('called');
  });

  it('ignores stale done events that predate the latest user message sequence', () => {
    const { handleEvent, setStreaming } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'message',
      event_id: 'u1',
      timestamp: 1,
      role: 'user',
      content: 'first',
      sequence: 10,
    } as AgentEvent);
    handleEvent({ type: 'done', event_id: 'd1', timestamp: 2, sequence: 20 } as AgentEvent);
    handleEvent({
      type: 'message',
      event_id: 'u2',
      timestamp: 3,
      role: 'user',
      content: 'modify',
      sequence: 30,
    } as AgentEvent);
    setStreaming(true);
    handleEvent({ type: 'done', event_id: 'd-stale', timestamp: 4, sequence: 25 } as AgentEvent);
    expect(useAppBuilderStudioStore.getState().streaming).toBe(true);
  });

  it('reconciles a missed final event after reconnect', async () => {
    useAppBuilderStudioStore.getState().setSessionId('s1');
    useAppBuilderStudioStore.getState().setStreaming(true);
    vi.spyOn(appBuilderStudioApi, 'listEvents').mockResolvedValue({
      items: [{ type: 'done', event_id: 'done-1', timestamp: 1, sequence: 1 }],
      nextSince: 1,
    });

    await useAppBuilderStudioStore.getState().reconcileCurrentSession();

    expect(appBuilderStudioApi.listEvents).toHaveBeenCalledWith('s1', 0, 200);
    expect(useAppBuilderStudioStore.getState().streaming).toBe(false);
    expect(useAppBuilderStudioStore.getState().lastSequence).toBe(1);
  });

  it('reconciles a missed final event when opening a cached background session', async () => {
    useAppBuilderStudioStore.getState().setSessionId('foreground');
    useAppBuilderStudioStore.getState().handleStreamEvent('message', {
      sessionId: 'background',
      event_id: 'assistant-1',
      timestamp: 1,
      sequence: 1,
      role: 'assistant',
      content: 'Partial response',
    });
    expect(useAppBuilderStudioStore.getState().streamingStateCache.get('background')?.streaming).toBe(true);
    vi.spyOn(appBuilderStudioApi, 'listEvents').mockResolvedValue({
      items: [{ type: 'done', event_id: 'done-1', timestamp: 2, sequence: 2 }],
      nextSince: 2,
    });

    expect(useAppBuilderStudioStore.getState().switchToSession('background')).toBe(true);
    await vi.waitFor(() => expect(useAppBuilderStudioStore.getState().streaming).toBe(false));

    expect(appBuilderStudioApi.listEvents).toHaveBeenCalledWith('background', 1, 200);
  });

  it('preserves Nodepod and deploy state when switching away from a non-streaming session', () => {
    useAppBuilderStudioStore.getState().setSessionId('session-a');
    useAppBuilderStudioStore.getState().handleEvent({
      type: 'application_component',
      event_id: 'app-a',
      timestamp: 1,
      title: 'App A',
      url: 'https://preview.example/app-a',
      ceph_path: 'yellowstorm/user/app-a/projectSRC',
      file_count: 3,
    });
    useAppBuilderStudioStore.getState().setDeployState({
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.example/app-a',
      lastDeployedAt: '2026-08-06T10:00:00.000Z',
    });
    useAppBuilderStudioStore.getState().setAppViewMode('deployed');
    useAppBuilderStudioStore.getState().setSystemWorkspaceId('ws-system-a');
    useAppBuilderStudioStore.getState().setWorkspaceIds(['ws-a-1', 'ws-a-2']);
    useAppBuilderStudioStore.getState().setSelectedSkillIds(['skill-a']);
    useAppBuilderStudioStore.getState().setSelectedConnectorIds(['connector-a']);
    useAppBuilderStudioStore.getState().setFilesSheetOpen(true);

    expect(useAppBuilderStudioStore.getState().switchToSession('session-b')).toBe(false);
    expect(useAppBuilderStudioStore.getState().switchToSession('session-a')).toBe(true);

    const state = useAppBuilderStudioStore.getState();
    expect(state.applicationComponent).toEqual({
      title: 'App A',
      url: 'https://preview.example/app-a',
      cephPath: 'yellowstorm/user/app-a/projectSRC',
      filesTree: null,
      fileCount: 3,
      revision: 'app-a',
    });
    expect(state.deployStatus).toBe('deployed');
    expect(state.deployedUrl).toBe('https://apps.example/app-a');
    expect(state.appViewMode).toBe('deployed');
    expect(state.systemWorkspaceId).toBe('ws-system-a');
    expect(state.workspaceIds).toEqual(['ws-a-1', 'ws-a-2']);
    expect(state.selectedSkillIds).toEqual(['skill-a']);
    expect(state.selectedConnectorIds).toEqual(['connector-a']);
    expect(state.filesSheetOpen).toBe(true);
  });

  it('hydrates background Nodepod progress and preview state from stream cache', () => {
    useAppBuilderStudioStore.getState().setSessionId('foreground');

    useAppBuilderStudioStore.getState().handleStreamEvent('app_build_progress', {
      sessionId: 'background',
      event_id: 'progress-1',
      timestamp: 1,
      sequence: 1,
      phase: 'creating_files',
      message: 'Creating files',
    });
    useAppBuilderStudioStore.getState().handleStreamEvent('application_component', {
      sessionId: 'background',
      event_id: 'app-1',
      timestamp: 2,
      sequence: 2,
      title: 'Background app',
      url: 'https://preview.example/background',
      ceph_path: 'yellowstorm/user/background/projectSRC',
      file_count: 2,
    });
    useAppBuilderStudioStore.getState().handleStreamEvent('done', {
      sessionId: 'background',
      event_id: 'done-1',
      timestamp: 3,
      sequence: 3,
    });

    expect(useAppBuilderStudioStore.getState().switchToSession('background')).toBe(true);

    const state = useAppBuilderStudioStore.getState();
    expect(state.rightPanelMode).toBe('app');
    expect(state.appBuildProgress).toBeNull();
    expect(state.applicationComponent).toEqual({
      title: 'Background app',
      url: 'https://preview.example/background',
      cephPath: 'yellowstorm/user/background/projectSRC',
      filesTree: null,
      fileCount: 2,
      revision: 'app-1',
    });
  });

  it('handleEvent("error") sets streamError and clears streaming', () => {
    const { handleEvent, setStreaming } = useAppBuilderStudioStore.getState();
    setStreaming(true);
    handleEvent({ type: 'error', event_id: 'e1', timestamp: 1, error: 'boom' });
    expect(useAppBuilderStudioStore.getState().streamError).toBe('boom');
    expect(useAppBuilderStudioStore.getState().streaming).toBe(false);
  });

  it('handleEvent("tool") auto-follows live for non-message tools', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'browser', status: 'calling', function: 'browser_navigate', args: { url: 'x' },
    });
    expect(useAppBuilderStudioStore.getState().liveToolCallId).toBe('tc1');
    expect(useAppBuilderStudioStore.getState().selectedToolCallId).toBe('tc1');
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('tool');

    handleEvent({
      type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 'tc2',
      name: 'search', status: 'calling', function: 'info_search_web', args: { query: 'q' },
    });
    expect(useAppBuilderStudioStore.getState().liveToolCallId).toBe('tc2');
    expect(useAppBuilderStudioStore.getState().selectedToolCallId).toBe('tc2');
  });

  it('handleEvent("tool") does not change selection when user is viewing a past tool', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'browser', status: 'calling', function: 'browser_navigate', args: {},
    });
    // User clicks a past tool.
    useAppBuilderStudioStore.setState({ selectedToolCallId: 'old' });
    handleEvent({
      type: 'tool', event_id: 'e2', timestamp: 2, tool_call_id: 'tc2',
      name: 'search', status: 'calling', function: 'info_search_web', args: {},
    });
    expect(useAppBuilderStudioStore.getState().liveToolCallId).toBe('tc2');
    expect(useAppBuilderStudioStore.getState().selectedToolCallId).toBe('old');
  });

  it('handleEvent("tool") ignores message tools for live tracking', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'tool', event_id: 'e1', timestamp: 1, tool_call_id: 'tc1',
      name: 'message', status: 'calling', function: 'message_notify_user', args: { text: 'hi' },
    });
    expect(useAppBuilderStudioStore.getState().liveToolCallId).toBeNull();
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('closed');
  });

  it('handleEvent("done") clears liveToolCallId', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    useAppBuilderStudioStore.setState({ liveToolCallId: 'tc1', streaming: true });
    handleEvent({ type: 'done', event_id: 'e1', timestamp: 1 });
    expect(useAppBuilderStudioStore.getState().liveToolCallId).toBeNull();
  });

  it('jumpToLive selects the live tool', () => {
    useAppBuilderStudioStore.setState({ liveToolCallId: 'live', selectedToolCallId: 'old', rightPanelMode: 'tool' });
    useAppBuilderStudioStore.getState().jumpToLive();
    expect(useAppBuilderStudioStore.getState().selectedToolCallId).toBe('live');
  });

  it('replayEvents keeps per-turn step/tool entries separate when ids repeat', () => {
    const { replayEvents } = useAppBuilderStudioStore.getState();
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
    const evs = useAppBuilderStudioStore.getState().events;
    const steps = evs.filter((e) => e.type === 'step');
    const tools = evs.filter((e) => e.type === 'tool');
    expect(steps).toHaveLength(2);
    expect(tools).toHaveLength(2);
  });

  it('replayEvents collapses duplicate tool/step/plan records', () => {
    const { replayEvents } = useAppBuilderStudioStore.getState();
    replayEvents([
      { type: 'message', event_id: 'm1', timestamp: 0, role: 'user', content: 'hi' },
      { type: 'tool', event_id: 't1a', timestamp: 1, tool_call_id: 'tc1', name: 'search', status: 'calling', function: 'q', args: {} },
      { type: 'tool', event_id: 't1b', timestamp: 2, tool_call_id: 'tc1', name: 'search', status: 'called', function: 'q', args: {}, content: { kind: 'search', query: 'q', results: [] } },
      { type: 'step', event_id: 's1a', timestamp: 3, id: 'step1', status: 'running', description: 'do' },
      { type: 'step', event_id: 's1b', timestamp: 4, id: 'step1', status: 'completed', description: 'do' },
      { type: 'plan', event_id: 'p1', timestamp: 5, steps: [{ id: 'step1', status: 'completed', description: 'do' }] },
      { type: 'plan', event_id: 'p2', timestamp: 6, steps: [{ id: 'step1', status: 'completed', description: 'do' }, { id: 'step2', status: 'pending', description: 'next' }] },
    ]);
    const evs = useAppBuilderStudioStore.getState().events;
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
    const { handleEvent } = useAppBuilderStudioStore.getState();
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

    const evs = useAppBuilderStudioStore.getState().events;
    const steps = evs.filter((e) => e.type === 'step');
    const tools = evs.filter((e) => e.type === 'tool');
    // Two separate steps and two separate tools, one per turn.
    expect(steps).toHaveLength(2);
    expect(steps.map((s: any) => s.event_id)).toEqual(['s1b', 's2a']);
    expect(tools).toHaveLength(2);
    expect(tools.map((t: any) => t.event_id)).toEqual(['t1a', 't2a']);
  });

  it('app_build_progress opens the app panel and is cleared on application_component', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'app_build_progress',
      event_id: 'p1',
      timestamp: 1,
      phase: 'creating_files',
      message: 'Creating project files',
    });
    expect(useAppBuilderStudioStore.getState().appBuildProgress).toEqual({
      phase: 'creating_files',
      message: 'Creating project files',
      revision: 'p1',
    });
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('app');
    expect(useAppBuilderStudioStore.getState().applicationComponent).toBeNull();

    handleEvent({
      type: 'application_component',
      event_id: 'app-1',
      timestamp: 2,
      title: 'App',
      url: 'http://localhost:5173',
      ceph_path: 'yellowstorm/user/app/projectSRC',
      file_count: 1,
    });
    expect(useAppBuilderStudioStore.getState().applicationComponent?.revision).toBe('app-1');
    expect(useAppBuilderStudioStore.getState().appBuildProgress).toBeNull();
  });

  it('replayEvents replaces events wholesale', () => {
    const { handleEvent, replayEvents } = useAppBuilderStudioStore.getState();
    handleEvent({ type: 'message', event_id: 'e1', timestamp: 1, role: 'assistant', content: 'a' });
    replayEvents([
      { type: 'message', event_id: 'r1', timestamp: 0, role: 'assistant', content: 'replay' },
    ]);
    const evs = useAppBuilderStudioStore.getState().events;
    expect(evs).toHaveLength(1);
    expect((evs[0] as any).event_id).toBe('r1');
  });

  it('setDeployState stores the live URL without rewriting Nodepod sources', () => {
    useAppBuilderStudioStore.getState().handleEvent({
      type: 'application_component',
      event_id: 'app-1',
      timestamp: 1,
      title: 'Generated app',
      url: 'https://preview.example/app',
      ceph_path: 'yellowstorm/user/app/projectSRC',
      file_count: 2,
    });

    useAppBuilderStudioStore.getState().setDeployState({
      deployStatus: 'deployed',
      deployedUrl: 'https://deployed.example/app',
    });

    expect(useAppBuilderStudioStore.getState().applicationComponent).toEqual({
      title: 'Generated app',
      url: 'https://preview.example/app',
      cephPath: 'yellowstorm/user/app/projectSRC',
      filesTree: null,
      fileCount: 2,
      revision: 'app-1',
    });
    expect(useAppBuilderStudioStore.getState().deployedUrl).toBe('https://deployed.example/app');
    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('nodepod');
  });

  it('sendMessage does not leave deployed mode on the first user message', async () => {
    vi.spyOn(appBuilderStudioApi, 'sendMessage').mockResolvedValueOnce(undefined);
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      appViewMode: 'deployed',
      deployedUrl: 'https://deployed.example/app',
      deployStatus: 'deployed',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
    });

    await useAppBuilderStudioStore.getState().sendMessage('first prompt');

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
  });

  it('sendMessage switches deployed → nodepod from the second user message', async () => {
    vi.spyOn(appBuilderStudioApi, 'sendMessage').mockResolvedValue(undefined);
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      appViewMode: 'deployed',
      deployedUrl: 'https://deployed.example/app',
      deployStatus: 'deployed',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
      events: [
        {
          type: 'message',
          event_id: 'u1',
          timestamp: 1,
          role: 'user',
          content: 'first',
          attachments: [],
        },
      ],
      rightPanelMode: 'closed',
    });

    await useAppBuilderStudioStore.getState().sendMessage('follow-up');

    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('nodepod');
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('app');
  });

  it('sendMessage skips a duplicate in-flight send (double-submit guard)', async () => {
    const sendSpy = vi
      .spyOn(appBuilderStudioApi, 'sendMessage')
      .mockResolvedValue(undefined);
    useAppBuilderStudioStore.setState({ sessionId: 'session-1' });
    const store = useAppBuilderStudioStore.getState();
    const first = store.sendMessage('duplicate');
    await store.sendMessage('duplicate');
    await first;
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const userMessages = useAppBuilderStudioStore
      .getState()
      .events.filter((e) => e.type === 'message' && (e as { role?: string }).role === 'user');
    expect(userMessages).toHaveLength(1);
  });

  it('sendMessage ships baseRevisionId when a historical version is selected', async () => {
    const sendSpy = vi
      .spyOn(appBuilderStudioApi, 'sendMessage')
      .mockResolvedValueOnce(undefined);
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      finalizedVersions: [
        { revisionId: 'rev_3', title: 'App', finalizedAt: '2026-09-03T00:00:00.000Z' },
        { revisionId: 'rev_2', title: 'App', finalizedAt: '2026-09-02T00:00:00.000Z' },
      ],
      previewRevisionId: 'rev_2',
    });

    await useAppBuilderStudioStore.getState().sendMessage('continue from version 2');

    expect(sendSpy).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ baseRevisionId: 'rev_2' }),
    );
  });

  it('sendMessage omits baseRevisionId when the latest version is selected', async () => {
    const sendSpy = vi
      .spyOn(appBuilderStudioApi, 'sendMessage')
      .mockResolvedValueOnce(undefined);
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      finalizedVersions: [
        { revisionId: 'rev_3', title: 'App', finalizedAt: '2026-09-03T00:00:00.000Z' },
        { revisionId: 'rev_2', title: 'App', finalizedAt: '2026-09-02T00:00:00.000Z' },
      ],
      previewRevisionId: 'rev_3',
    });

    await useAppBuilderStudioStore.getState().sendMessage('keep going');

    const body = sendSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(body).toBeDefined();
    expect(body!['baseRevisionId']).toBeUndefined();
  });

  it('deploy sends the application component title to the backend', async () => {
    const deploySpy = vi.spyOn(appBuilderStudioApi, 'deploySession').mockResolvedValueOnce({
      deployStatus: 'deployed',
      deployedUrl: 'https://deployed.example/app',
      lastDeployedAt: '2026-07-17T10:00:00.000Z',
    });
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      applicationComponent: {
        title: 'Generated app',
        url: 'https://preview.example/app',
        revision: 'app-1',
      },
    });

    await useAppBuilderStudioStore.getState().deploy();

    expect(deploySpy).toHaveBeenCalledWith('session-1', {
      title: 'Generated app',
      revisionId: undefined,
    });
    expect(useAppBuilderStudioStore.getState().lastDeployedAt).toBe(
      '2026-07-17T10:00:00.000Z',
    );
    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
  });

  it('deploy prefers previewRevisionId then latest finalized version', async () => {
    const deploySpy = vi.spyOn(appBuilderStudioApi, 'deploySession').mockResolvedValueOnce({
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      lastDeployedAt: '2026-08-14T10:00:00.000Z',
    });
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      previewRevisionId: 'rev_7',
      finalizedVersions: [
        {
          revisionId: 'rev_15',
          title: 'Latest finalized',
          finalizedAt: '2026-08-14T10:00:00.000Z',
        },
        {
          revisionId: 'rev_7',
          title: 'Older finalized',
          finalizedAt: '2026-08-01T10:00:00.000Z',
        },
      ],
      applicationComponent: {
        title: 'Generated app',
        url: 'nodepod://preview',
        revision: 'evt-1',
        workspaceRevisionId: 'rev_20',
      },
    });

    await useAppBuilderStudioStore.getState().deploy();

    expect(deploySpy).toHaveBeenCalledWith('session-1', {
      title: 'Older finalized',
      revisionId: 'rev_7',
    });
  });

  it('deploy reconciles from session pointer after a network drop', async () => {
    const networkErr = new AxiosError('Network Error', 'ERR_NETWORK');
    vi.spyOn(appBuilderStudioApi, 'deploySession').mockRejectedValueOnce(networkErr);
    vi.spyOn(appBuilderStudioApi, 'getSession')
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        title: 'App',
        status: 'active',
        isShared: false,
        workspaceIds: [],
        selectedSkillIds: [],
        selectedConnectorIds: [],
        lastEventAt: '',
        eventCount: 0,
        systemWorkspaceId: null,
        deployStatus: 'deploying',
        deployedUrl: null,
        lastDeployedAt: null,
      })
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        title: 'App',
        status: 'active',
        isShared: false,
        workspaceIds: [],
        selectedSkillIds: [],
        selectedConnectorIds: [],
        lastEventAt: '',
        eventCount: 0,
        systemWorkspaceId: null,
        deployStatus: 'deployed',
        deployedUrl: 'https://apps.yellowsys.org/apps/abc/',
        lastDeployedAt: '2026-08-14T10:00:00.000Z',
      });

    vi.useFakeTimers();
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      deployStatus: 'idle',
    });

    const deployPromise = useAppBuilderStudioStore.getState().deploy();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await deployPromise;
    vi.useRealTimers();

    expect(useAppBuilderStudioStore.getState().deployStatus).toBe('deployed');
    expect(useAppBuilderStudioStore.getState().deployedUrl).toBe(
      'https://apps.yellowsys.org/apps/abc/',
    );
    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
  });

  it('deploy sends the latest finalized workspace revision id when preview is unset', async () => {
    const deploySpy = vi.spyOn(appBuilderStudioApi, 'deploySession').mockResolvedValueOnce({
      deployStatus: 'deployed',
      deployedUrl: 'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
      lastDeployedAt: '2026-08-14T10:00:00.000Z',
    });
    useAppBuilderStudioStore.setState({
      sessionId: 'session-1',
      finalizedVersions: [
        {
          revisionId: 'rev_15',
          title: 'Generated app',
          finalizedAt: '2026-08-14T10:00:00.000Z',
        },
      ],
      applicationComponent: {
        title: 'Generated app',
        url: 'nodepod://preview',
        revision: 'evt-1',
        workspaceRevisionId: 'rev_15',
      },
    });

    await useAppBuilderStudioStore.getState().deploy();

    expect(deploySpy).toHaveBeenCalledWith('session-1', {
      title: 'Generated app',
      revisionId: 'rev_15',
    });
    expect(useAppBuilderStudioStore.getState().appViewMode).toBe('deployed');
    expect(useAppBuilderStudioStore.getState().deployedUrl).toBe(
      'https://apps.yellowsys.org/apps/2e65d5fa87a0499f/',
    );
  });

  it('replayEvents restores application sources without overwriting with deployed URL', () => {
    useAppBuilderStudioStore.setState({
      deployedUrl: 'https://deployed.example/app',
      deployStatus: 'deployed',
    });

    useAppBuilderStudioStore.getState().replayEvents([
      {
        type: 'application_component',
        event_id: 'app-1',
        timestamp: 1,
        title: 'Generated app',
        url: 'https://preview.example/app',
        ceph_path: 'yellowstorm/user/app/projectSRC',
      },
    ]);

    expect(useAppBuilderStudioStore.getState().applicationComponent).toEqual({
      title: 'Generated app',
      url: 'https://preview.example/app',
      cephPath: 'yellowstorm/user/app/projectSRC',
      filesTree: null,
      fileCount: undefined,
      revision: 'app-1',
      workspaceRevisionId: undefined,
    });
  });

  it('keeps workspaceRevisionId when a later application_component omits revision_id', () => {
    const { handleEvent } = useAppBuilderStudioStore.getState();
    handleEvent({
      type: 'application_component',
      event_id: 'app-1',
      timestamp: 1,
      title: 'App',
      url: 'nodepod://preview',
      revision_id: 'rev_15',
    });
    handleEvent({
      type: 'application_component',
      event_id: 'app-2',
      timestamp: 2,
      title: 'App',
      url: 'nodepod://preview',
    });
    expect(useAppBuilderStudioStore.getState().applicationComponent?.workspaceRevisionId).toBe(
      'rev_15',
    );
  });
});
