import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeExecution, makeExecutionSummary, makePlaybook, makeTask } from './test-utils';
import { usePlaybookStore } from './store';

const apiMock = vi.hoisted(() => ({
  getPlaybooks: vi.fn(),
  getPlaybook: vi.fn(),
  createPlaybook: vi.fn(),
  generatePlaybook: vi.fn(),
  updatePlaybook: vi.fn(),
  deletePlaybook: vi.fn(),
  clonePlaybook: vi.fn(),
  executePlaybook: vi.fn(),
  cancelFlowExecution: vi.fn(),
  resumeFlowApproval: vi.fn(),
  rerunPlaybookStep: vi.fn(),
  resumePlaybookFromStep: vi.fn(),
  deleteExecution: vi.fn(),
  deleteAllExecutions: vi.fn(),
  getExecutions: vi.fn(),
  getExecution: vi.fn(),
  toggleFavorite: vi.fn(),
  bulkDeletePlaybooks: vi.fn(),
  getDesignMessages: vi.fn(),
  designPlaybook: vi.fn(),
  revertToSnapshot: vi.fn(),
  upsertPlaybookTriggerSchedule: vi.fn(),
  clearPlaybookTriggerSchedule: vi.fn(),
  getPlaybookRepeatability: vi.fn(),
  runAdvisorEvaluation: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

const autoLayoutMock = vi.hoisted(() => vi.fn((tasks) => tasks));
const handleApiErrorMock = vi.hoisted(() => vi.fn());
const parseApiErrorMock = vi.hoisted(() => vi.fn(() => ({ message: 'parseApiError message' })));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ...apiMock };
});
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('./utils/auto-layout', () => ({ autoLayoutTasks: autoLayoutMock }));
vi.mock('@/lib/api-error', () => ({ handleApiError: handleApiErrorMock, parseApiError: parseApiErrorMock }));
vi.mock('@/modules/localization/i18nInstance', () => ({
  i18nInstance: { isInitialized: false, t: (key: string) => key },
}));

describe('playbook store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybookStore.getState().reset();
  });

  afterEach(() => {
    usePlaybookStore.getState().reset();
  });

  it('fetches playbooks and applies default pagination query', async () => {
    apiMock.getPlaybooks.mockResolvedValueOnce({
      playbooks: [{ id: 'p1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    await usePlaybookStore.getState().fetchPlaybooks({ search: 'ops' });
    const state = usePlaybookStore.getState();

    expect(apiMock.getPlaybooks).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'ops' });
    expect(state.playbooks).toHaveLength(1);
    expect(state.playbooksLoading).toBe(false);
  });

  it('generates playbook and stores layouted current playbook', async () => {
    const playbook = makePlaybook({ id: 'generated-id' });
    apiMock.generatePlaybook.mockResolvedValueOnce({ id: 'generated-id' });
    apiMock.getPlaybook.mockResolvedValueOnce(playbook);
    apiMock.getPlaybooks.mockResolvedValueOnce({ playbooks: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    const id = await usePlaybookStore.getState().generatePlaybook({ name: 'PB', prompt: 'build flow' });
    const state = usePlaybookStore.getState();

    expect(id).toBe('generated-id');
    expect(autoLayoutMock).toHaveBeenCalledWith(playbook.tasks, playbook.edges);
    expect(state.currentPlaybook?.id).toBe('generated-id');
    expect(state.isDirty).toBe(true);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('optimistically creates a pending execution when starting a full workflow', async () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Step 1', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Step 2', executionOrder: 2 }),
      ],
    });
    apiMock.executePlaybook.mockResolvedValueOnce({ executionId: 'e-start' });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false, selectedStepId: null });

    const executionId = await usePlaybookStore.getState().executePlaybook('p1');
    const state = usePlaybookStore.getState();

    expect(executionId).toBe('e-start');
    expect(state.currentExecution?.id).toBe('e-start');
    expect(state.currentExecution?.status).toBe('running');
    expect(state.currentExecution?.taskResults[0]).toMatchObject({ taskId: 't1', status: 'pending' });
    expect(state.currentExecution?.taskResults[1]).toMatchObject({ taskId: 't2', status: 'pending' });
    expect(state.selectedStepId).toBe('t1');
      expect(state.executionPanelOpen).toBe(true);
      expect(state.pageMode).toBe('run');
    });

  it('still marks the chosen step as running for single-step execution', async () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Step 1', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Step 2', executionOrder: 2 }),
      ],
    });
    apiMock.executePlaybook.mockResolvedValueOnce({ executionId: 'e-single' });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false, selectedStepId: null });

    await usePlaybookStore.getState().executePlaybook('p1', { singleStepTaskId: 't2' });
    const state = usePlaybookStore.getState();

    expect(state.currentExecution?.taskResults[0]).toMatchObject({ taskId: 't1', status: 'pending' });
    expect(state.currentExecution?.taskResults[1]).toMatchObject({ taskId: 't2', status: 'running' });
    expect(state.selectedStepId).toBe('t2');
  });

  it('applies single-step judge SSE updates to the optimistic base iteration', async () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Step 1', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Step 2', executionOrder: 2 }),
      ],
    });
    apiMock.executePlaybook.mockResolvedValueOnce({ executionId: 'e-single' });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false, selectedStepId: null });

    await usePlaybookStore.getState().executePlaybook('p1', { singleStepTaskId: 't2' });
    usePlaybookStore.getState().onStepComplete({
      executionId: 'e-single',
      taskId: 't2',
      iteration: 0,
      status: 'completed',
      output: 'done',
    });
    usePlaybookStore.getState().onStepJudgeStarted({
      executionId: 'e-single',
      taskId: 't2',
      iteration: 0,
      judgeStatus: 'evaluating',
    });
    usePlaybookStore.getState().onStepJudgeUpdated({
      executionId: 'e-single',
      taskId: 't2',
      iteration: 0,
      judgeStatus: 'evaluated',
      judgeError: null,
      judgeResult: { overallScore: 95 } as any,
    });

    const matchingResults = usePlaybookStore.getState().executionCache['e-single'].taskResults.filter((tr) => tr.taskId === 't2');
    expect(matchingResults).toHaveLength(1);
    expect(matchingResults[0]).toMatchObject({
      taskId: 't2',
      status: 'completed',
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 95 },
    });
  });

  it('survives execution_start SSE overwrite and correctly applies single-step judge SSE updates', () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Step 1', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Step 2', executionOrder: 2 }),
      ],
    });
    apiMock.executePlaybook.mockResolvedValueOnce({ executionId: 'e-single' });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false, selectedStepId: null });

    return usePlaybookStore.getState().executePlaybook('p1', { singleStepTaskId: 't2' }).then(() => {
      // SSE execution_start arrives AFTER optimistic — replaces cache with empty taskResults
      usePlaybookStore.getState().onExecutionStart({
        executionId: 'e-single',
        playbookId: 'p1',
        executionNumber: 1,
        status: 'running',
      });

      // SSE step_start recreates the task with iteration: 0
      usePlaybookStore.getState().onStepStart({ executionId: 'e-single', taskId: 't2', status: 'running' });

      // SSE step_complete
      usePlaybookStore.getState().onStepComplete({
        executionId: 'e-single',
        taskId: 't2',
        iteration: 0,
        status: 'completed',
        output: 'done',
      });

      // SSE judge events
      usePlaybookStore.getState().onStepJudgeStarted({
        executionId: 'e-single',
        taskId: 't2',
        iteration: 0,
        judgeStatus: 'evaluating',
      });
      usePlaybookStore.getState().onStepJudgeUpdated({
        executionId: 'e-single',
        taskId: 't2',
        iteration: 0,
        judgeStatus: 'evaluated',
        judgeError: null,
        judgeResult: { overallScore: 95 } as any,
      });

      const matchingResults = usePlaybookStore.getState().executionCache['e-single'].taskResults
        .filter((tr) => tr.taskId === 't2');
      expect(matchingResults).toHaveLength(1);
      expect(matchingResults[0]).toMatchObject({
        taskId: 't2',
        status: 'completed',
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 95 },
      });
    });
  });

  it('refreshes execution details after completion so terminal task states win', async () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      taskResults: [
        {
          taskId: 't1',
          nodeTitle: 'Step 1',
          agentName: 'Agent 1',
          order: 1,
          status: 'running',
          output: null,
          error: null,
          durationMs: null,
          startedAt: '2026-04-11T07:00:00.000Z',
          completedAt: null,
        },
        {
          taskId: 't2',
          nodeTitle: 'Step 2',
          agentName: 'Agent 2',
          order: 2,
          status: 'running',
          output: null,
          error: null,
          durationMs: null,
          startedAt: '2026-04-11T07:00:00.000Z',
          completedAt: null,
        },
      ] as any,
    });
    const completedExecution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        {
          taskId: 't1',
          nodeTitle: 'Step 1',
          agentName: 'Agent 1',
          order: 1,
          status: 'completed',
          output: 'done',
          error: null,
          durationMs: 100,
          startedAt: '2026-04-11T07:00:00.000Z',
          completedAt: '2026-04-11T07:00:10.000Z',
        },
        {
          taskId: 't2',
          nodeTitle: 'Step 2',
          agentName: 'Agent 2',
          order: 2,
          status: 'completed',
          output: 'done',
          error: null,
          durationMs: 100,
          startedAt: '2026-04-11T07:00:00.000Z',
          completedAt: '2026-04-11T07:00:10.000Z',
        },
      ] as any,
    });

    apiMock.getExecution.mockResolvedValueOnce(completedExecution);
    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1' }),
      currentExecution: execution,
      executionCache: { e1: execution },
      executionHistory: [makeExecutionSummary({ id: 'e1', playbookId: 'p1', status: 'running' })],
    });

    usePlaybookStore.getState().onExecutionComplete({
      executionId: 'e1',
      status: 'completed',
      durationMs: 1234,
      skippedTaskIds: [],
    } as any);

    expect(usePlaybookStore.getState().currentExecution?.taskResults[0].status).toBe('completed');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiMock.getExecution).toHaveBeenCalledWith('p1', 'e1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePlaybookStore.getState().currentExecution?.status).toBe('completed');
    expect(usePlaybookStore.getState().currentExecution?.taskResults[0].status).toBe('completed');
  });

  it('stores generate retry payload when generation fails', async () => {
    apiMock.generatePlaybook.mockRejectedValueOnce(new Error('boom'));
    await expect(usePlaybookStore.getState().generatePlaybook({ name: 'PB', prompt: 'x' })).rejects.toThrow('boom');
    expect(usePlaybookStore.getState().generateRetryData).toEqual({ name: 'PB', prompt: 'x' });
  });

  it('adds cloned playbook to the top of the list', async () => {
    const cloned = makePlaybook({ id: 'p2', name: 'Playbook (copy)' });
    apiMock.clonePlaybook.mockResolvedValueOnce(cloned);
    usePlaybookStore.setState({
      playbooks: [{ id: 'p1', name: 'Existing', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: false, lastExecutionAt: null, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }],
    });

    const result = await usePlaybookStore.getState().clonePlaybook('p1');
    const state = usePlaybookStore.getState();

    expect(apiMock.clonePlaybook).toHaveBeenCalledWith('p1');
    expect(result.id).toBe('p2');
    expect(state.playbooks[0].id).toBe('p2');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('keeps newer local edits when an older save response returns', async () => {
    let resolveUpdate: ((value: ReturnType<typeof makePlaybook>) => void) | null = null;
    apiMock.updatePlaybook.mockImplementationOnce(() => new Promise((resolve) => {
      resolveUpdate = resolve as (value: ReturnType<typeof makePlaybook>) => void;
    }));

    const initialPlaybook = makePlaybook({
      id: 'p1',
      tasks: [makeTask({ id: 't1', inputFiles: [] })],
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    usePlaybookStore.setState({
      currentPlaybook: initialPlaybook,
      playbooks: [{
        id: 'p1',
        name: initialPlaybook.name,
        description: initialPlaybook.description,
        taskCount: initialPlaybook.tasks.length,
        isFavorite: initialPlaybook.isFavorite,
        scheduleEnabled: false,
        lastExecutionAt: null,
        createdAt: initialPlaybook.createdAt,
        updatedAt: initialPlaybook.updatedAt,
      }],
    });

    usePlaybookStore.getState().addInputFileToTask('t1', {
      id: 'doc-1',
      name: 'Spec',
      type: 'document',
      metadata: { documentId: 'doc-1' },
    });

    const savePromise = usePlaybookStore.getState().saveCurrentPlaybook();

    usePlaybookStore.getState().addInputFileToTask('t1', {
      id: 'doc-2',
      name: 'Checklist',
      type: 'document',
      metadata: { documentId: 'doc-2' },
    });

    if (resolveUpdate) {
      const completeUpdate = resolveUpdate as (value: ReturnType<typeof makePlaybook>) => void;
      completeUpdate(makePlaybook({
        ...initialPlaybook,
        id: 'p1',
        tasks: [makeTask({
          id: 't1',
          inputFiles: [{
            id: 'doc-1',
            name: 'Spec',
            type: 'document',
            metadata: { documentId: 'doc-1' },
          }],
        })],
        updatedAt: '2025-01-01T00:00:10.000Z',
      }));
    }
    await savePromise;

    const state = usePlaybookStore.getState();
    expect(state.isSaving).toBe(false);
    expect(state.isDirty).toBe(true);
    expect(state.currentPlaybook?.tasks[0].inputFiles).toEqual([
      {
        id: 'doc-1',
        name: 'Spec',
        type: 'document',
        metadata: { documentId: 'doc-1' },
      },
      {
        id: 'doc-2',
        name: 'Checklist',
        type: 'document',
        metadata: { documentId: 'doc-2' },
      },
    ]);
    expect(state.currentPlaybook?.updatedAt).toBe('2025-01-01T00:00:10.000Z');
  });

  it('clears dirty state when the save response matches the latest local version', async () => {
    const savedPlaybook = makePlaybook({
      id: 'p1',
      tasks: [makeTask({ id: 't1', title: 'Renamed task' })],
      reflectionEnabled: false,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 93,
      advisorAutopilotMaxTurns: 5,
      updatedAt: '2025-01-01T00:00:20.000Z',
    });
    apiMock.updatePlaybook.mockResolvedValueOnce(savedPlaybook);

    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({
        id: 'p1',
        tasks: [makeTask({ id: 't1', title: 'Task' })],
      }),
      playbooks: [{
        id: 'p1',
        name: 'Playbook',
        description: 'Description',
        taskCount: 1,
        isFavorite: false,
        scheduleEnabled: false,
        lastExecutionAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      }],
    });

    usePlaybookStore.getState().updateTasks([makeTask({ id: 't1', title: 'Renamed task' })]);
    await usePlaybookStore.getState().saveCurrentPlaybook();

    const state = usePlaybookStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.isSaving).toBe(false);
    expect(state.currentPlaybook?.tasks[0].title).toBe('Renamed task');
    expect(state.currentPlaybook).toMatchObject({
      reflectionEnabled: false,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 93,
      advisorAutopilotMaxTurns: 5,
    });
    expect(state.currentPlaybook?.updatedAt).toBe('2025-01-01T00:00:20.000Z');
  });

  it('merges step completion and preserves existing pending human feedback', () => {
    const execution = makeExecution({
      id: 'e1',
      taskResults: [
        {
          taskId: 't1',
          nodeTitle: 'N1',
          agentName: 'A1',
          order: 1,
          status: 'running',
          output: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: null,
          components: [{ type: 'humanFeedback', data: { status: 'pending' } }],
        },
      ],
    });

    usePlaybookStore.setState({ executionCache: { e1: execution }, currentExecution: execution });
    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 't1',
      status: 'completed',
      components: [{ type: 'text', data: { text: 'done' } } as any],
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('completed');
    expect(updated.components?.some((c) => c.type === 'humanFeedback')).toBe(true);
    expect(updated.components?.some((c) => c.type === 'text')).toBe(true);
  });

  it('clears stale state when a step restarts and completes', () => {
    const execution = makeExecution({
      id: 'e1',
      taskResults: [
        {
          ...makeExecution().taskResults[0],
          taskId: 't1',
          status: 'completed',
          output: 'old output',
          completedAt: '2025-01-01T00:00:10.000Z',
          isStale: true,
          staleReason: 'Invalidated',
          invalidatedByTaskId: 't0',
        },
      ],
    });

    usePlaybookStore.setState({ executionCache: { e1: execution }, currentExecution: execution });

    usePlaybookStore.getState().onStepStart({ executionId: 'e1', taskId: 't1', status: 'running' });
    let updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('running');
    expect(updated.isStale).toBe(false);
    expect(updated.output).toBeNull();
    expect(updated.completedAt).toBeNull();

    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 't1',
      status: 'completed',
      output: 'fresh output',
    });

    updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('completed');
    expect(updated.isStale).toBe(false);
    expect(updated.staleReason).toBeNull();
    expect(updated.output).toBe('fresh output');
  });

  it('marks a running ancestor completed when a dependent step starts', () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Step 1', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Step 2', executionOrder: 2 }),
      ],
      edges: [
        { id: 'e1', sourceId: 't1', targetId: 't2', sourceOutputPortId: 'default', targetInputPortId: 'default' },
      ],
    });
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 't1', status: 'running', startedAt: '2025-01-01T00:00:00.000Z' },
        { ...makeExecution().taskResults[1], taskId: 't2', status: 'pending' },
      ],
    });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionCache: { e1: execution }, currentExecution: execution });

    usePlaybookStore.getState().onStepStart({ executionId: 'e1', taskId: 't2', status: 'running' });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(updated.find((task) => task.taskId === 't1')?.status).toBe('completed');
    expect(updated.find((task) => task.taskId === 't2')?.status).toBe('running');
  });

  it('keeps unrelated parallel running tasks when another branch starts', () => {
    const playbook = makePlaybook({
      id: 'p1',
      tasks: [
        makeTask({ id: 't1', title: 'Branch A', executionOrder: 1 }),
        makeTask({ id: 't2', title: 'Branch B', executionOrder: 2 }),
      ],
      edges: [],
    });
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 't1', status: 'running', startedAt: '2025-01-01T00:00:00.000Z' },
        { ...makeExecution().taskResults[1], taskId: 't2', status: 'pending' },
      ],
    });

    usePlaybookStore.setState({ currentPlaybook: playbook, executionCache: { e1: execution }, currentExecution: execution });

    usePlaybookStore.getState().onStepStart({ executionId: 'e1', taskId: 't2', status: 'running' });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(updated.find((task) => task.taskId === 't1')?.status).toBe('running');
    expect(updated.find((task) => task.taskId === 't2')?.status).toBe('running');
  });

  it('normalizes running ancestors from cached execution snapshots even when another playbook is open', () => {
    const cachedExecution = makeExecution({
      id: 'e1',
      playbookId: 'p-cached',
      playbookSnapshot: {
        tasks: [
          { id: 't1' },
          { id: 't2' },
        ],
        edges: [
          { id: 'e1', sourceId: 't1', targetId: 't2', sourceOutputPortId: 'default', targetInputPortId: 'default' },
        ],
      },
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 't1', status: 'running', startedAt: '2025-01-01T00:00:00.000Z' },
        { ...makeExecution().taskResults[1], taskId: 't2', status: 'pending' },
      ],
    });

    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p-other' }),
      executionCache: { e1: cachedExecution },
      currentExecution: null,
    });

    usePlaybookStore.getState().onStepStart({ executionId: 'e1', taskId: 't2', status: 'running' });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(updated.find((task) => task.taskId === 't1')?.status).toBe('completed');
    expect(updated.find((task) => task.taskId === 't2')?.status).toBe('running');
  });

  it('handles interrupt by appending pending human feedback and selecting step', () => {
    const execution = makeExecution({ id: 'e1', playbookId: 'p1', taskResults: [{ ...makeExecution().taskResults[0], taskId: 'task-1', components: [] }] });
    usePlaybookStore.setState({
      executionCache: { e1: execution },
      currentExecution: execution,
      executionHistory: [makeExecutionSummary({ id: 'e1', playbookId: 'p1' })],
      executingPlaybookIds: ['p1'],
    });

    usePlaybookStore.getState().onInterrupt({
      executionId: 'e1',
      taskId: 'task-1',
      type: 'approval_request',
      message: 'Approve?',
      threadId: 'th-1',
    });

    const state = usePlaybookStore.getState();
    expect(state.selectedStepId).toBe('task-1');
    expect(state.executingPlaybookIds).not.toContain('p1');
    expect(state.executionCache.e1.taskResults[0].components?.[0].type).toBe('humanFeedback');
    expect(state.executionCache.e1.waitingForHumanInput).toBe(true);
    expect(state.executionCache.e1.currentInterruptId).toBeNull();
    expect(state.executionCache.e1.currentInterruptTaskId).toBe('task-1');
    expect(state.executionCache.e1.hitlHistory?.[0]).toMatchObject({ taskId: 'task-1', status: 'pending' });
  });

  it('does not downgrade a completed step back to running on late step updates', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        status: 'completed',
        output: 'Final output',
        completedAt: '2025-01-01T00:00:05.000Z',
        artifacts: [{ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
      } as any],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepUpdate({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'running',
      output: 'Late token',
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('completed');
    expect(updated.output).toBe('Late token');
    expect(updated.artifacts).toEqual([{ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }]);
  });

  it('keeps completed step artifacts when completion SSE omits them', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        status: 'running',
        artifacts: [{ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
      } as any],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'completed',
      output: 'Done',
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('completed');
    expect(updated.artifacts).toEqual([{ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }]);
  });

  it('normalizes snake_case artifacts from step completion SSE payloads', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        status: 'running',
      } as any],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'completed',
      output: 'Done',
      artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf', mime_type: 'application/pdf' }] as any,
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.artifacts).toEqual([expect.objectContaining({ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf', mimeType: 'application/pdf' })]);
  });

  it('applies completion and judge SSE updates only to the matching iteration', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', output: 'old-0', judgeStatus: 'idle' } as any,
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'running', output: null, judgeStatus: 'idle' } as any,
      ],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 'task-1',
      iteration: 1,
      status: 'completed',
      output: 'done-1',
    });
    usePlaybookStore.getState().onStepJudgeStarted({
      executionId: 'e1',
      taskId: 'task-1',
      iteration: 1,
      judgeStatus: 'evaluating',
    });
    usePlaybookStore.getState().onStepJudgeUpdated({
      executionId: 'e1',
      taskId: 'task-1',
      iteration: 1,
      judgeStatus: 'evaluated',
      judgeError: null,
      judgeResult: { overallScore: 0.9 } as any,
    });

    const [firstIteration, secondIteration] = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(firstIteration.output).toBe('old-0');
    expect(firstIteration.judgeStatus).toBe('idle');
    expect(secondIteration.output).toBe('done-1');
    expect(secondIteration.judgeStatus).toBe('evaluated');
  });

  it('does not restore running playbook status after execution already completed', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      completedAt: '2025-01-01T00:00:05.000Z',
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        status: 'completed',
        completedAt: '2025-01-01T00:00:05.000Z',
      } as any],
    });

    usePlaybookStore.setState({
      currentExecution: execution,
      executionCache: { e1: execution },
      playbooks: [{ id: 'p1', name: 'Playbook', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: false, executionStatus: 'completed', lastExecutionAt: null, createdAt: '', updatedAt: '' } as any],
    });

    usePlaybookStore.getState().onStepUpdate({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'running',
      output: 'late token',
    });

    const state = usePlaybookStore.getState();
    expect(state.currentExecution?.status).toBe('completed');
    expect(state.playbooks[0].executionStatus).toBe('completed');
  });

  it('normalizes snake_case artifacts when step completion is the first event seen for a task', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepComplete({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'completed',
      output: 'Done',
      artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }] as any,
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.artifacts).toEqual([expect.objectContaining({ portId: 'report', artifactKind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' })]);
  });

  it('preserves terminal metadata on late step updates', () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        status: 'completed',
        error: 'final error',
        durationMs: 500,
        completedAt: '2025-01-01T00:00:05.000Z',
      } as any],
    });

    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution } });

    usePlaybookStore.getState().onStepUpdate({
      executionId: 'e1',
      taskId: 'task-1',
      status: 'running',
      output: 'late token',
    });

    const updated = usePlaybookStore.getState().executionCache.e1.taskResults[0];
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBe('2025-01-01T00:00:05.000Z');
    expect(updated.durationMs).toBe(500);
    expect(updated.error).toBe('final error');
  });

  it('resumes execution with interrupt id and clears waiting state optimistically', async () => {
    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'interrupted',
      waitingForHumanInput: true,
      currentInterruptId: 'interrupt-1',
      currentInterruptTaskId: 'task-1',
      interruptPayload: {
        type: 'clarification',
        taskId: 'task-1',
        taskTitle: 'Task 1',
        message: 'Need input',
        threadId: 'th-1',
        interruptId: 'interrupt-1',
      },
      hitlHistory: [{
        interruptId: 'interrupt-1', taskId: 'task-1', type: 'clarification', taskTitle: 'Task 1', message: 'Need input', taskDescription: '', result: '', round: 1, payloadJson: '', resumableActions: ['reply'], status: 'pending', responseAction: null, responseMessage: null, responseApproved: null, responseReason: null, responseFeedback: null, respondedBy: null, respondedAt: null, createdAt: '2025-01-01T00:00:00.000Z',
      }],
      taskResults: [{
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        components: [{ type: 'humanFeedback', data: { status: 'pending', interruptId: 'interrupt-1' } }],
      }],
    });
    usePlaybookStore.setState({ currentExecution: execution, executionCache: { e1: execution }, executingPlaybookIds: [] });

    await usePlaybookStore.getState().resumeExecution('p1', {
      executionId: 'e1',
      taskId: 'task-1',
      interruptId: 'interrupt-1',
      action: 'reply',
      message: 'Here you go',
    });

    expect(apiMock.resumeFlowApproval).toHaveBeenCalledWith(
      'e1',
      'reply',
      expect.objectContaining({
        taskId: 'task-1',
        interruptId: 'interrupt-1',
        message: 'Here you go',
      }),
    );
    const updated = usePlaybookStore.getState().executionCache.e1;
    expect(updated.status).toBe('running');
    expect(updated.interruptPayload).toBeNull();
    expect(updated.waitingForHumanInput).toBe(false);
    expect(updated.currentInterruptId).toBeNull();
    expect(updated.currentInterruptTaskId).toBeNull();
    expect(updated.hitlHistory?.[0]).toMatchObject({ status: 'answered', responseAction: 'reply', responseMessage: 'Here you go' });
  });

  it('stopExecution uses flow cancellation route', async () => {
    apiMock.cancelFlowExecution.mockResolvedValueOnce(undefined);

    await usePlaybookStore.getState().stopExecution('p1', 'e1');

    expect(apiMock.cancelFlowExecution).toHaveBeenCalledWith('e1');
  });

  // ===== Execution Panel =====

  it('viewExecutionInPanel loads from cache and opens panel', () => {
    const execution = makeExecution({ id: 'e1' });
    usePlaybookStore.setState({ executionCache: { e1: execution }, executionPanelOpen: false });
    usePlaybookStore.getState().viewExecutionInPanel('e1');
    const state = usePlaybookStore.getState();
    expect(state.currentExecution?.id).toBe('e1');
    expect(state.executionPanelOpen).toBe(true);
    expect(state.selectedStepId).toBe('task-1');
    expect(state.pageMode).toBe('run');
  });

  it('viewExecutionInPanel preserves selected step when switching executions', () => {
    const executionA = makeExecution({
      id: 'e1',
      taskResults: [
        { taskId: 'task-1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
        { taskId: 'task-2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
      ],
    });
    const executionB = makeExecution({
      id: 'e2',
      taskResults: [
        { taskId: 'task-1', nodeTitle: 'Step 1', agentName: '', order: 1, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
        { taskId: 'task-2', nodeTitle: 'Step 2', agentName: '', order: 2, status: 'completed', output: null, error: null, durationMs: 100, startedAt: '', completedAt: '' },
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: executionA, e2: executionB },
      currentExecution: executionA,
      selectedStepId: 'task-2',
      executionPanelOpen: true,
    });

    usePlaybookStore.getState().viewExecutionInPanel('e2');

    const state = usePlaybookStore.getState();
    expect(state.currentExecution?.id).toBe('e2');
    expect(state.selectedStepId).toBe('task-2');
  });

  it('viewExecutionInPanel fetches from API when not cached', () => {
    const playbook = makePlaybook({ id: 'p1' });
    apiMock.getExecution.mockResolvedValueOnce(makeExecution({ id: 'e2' }));
    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false });
    usePlaybookStore.getState().viewExecutionInPanel('e2');
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(true);
    expect(apiMock.getExecution).toHaveBeenCalledWith('p1', 'e2');
  });

  it('deleteAllExecutions calls api and clears cached state', async () => {
    apiMock.deleteAllExecutions.mockResolvedValueOnce({ deleted: 3, kept: 0 });

    usePlaybookStore.setState({
      currentExecution: { id: 'e1', playbookId: 'p1', status: 'failed' } as any,
      executionCache: { e1: { id: 'e1', playbookId: 'p1' } as any, e2: { id: 'e2', playbookId: 'p1' } as any },
      executionHistory: [{ id: 'e1', playbookId: 'p1' } as any, { id: 'e3', playbookId: 'p2' } as any],
      executionHistoryByPlaybook: { p1: [{ id: 'e1', playbookId: 'p1' } as any], p2: [{ id: 'e3', playbookId: 'p2' } as any] },
      executionPanelOpen: true,
    });

    await usePlaybookStore.getState().deleteAllExecutions('p1');

    expect(apiMock.deleteAllExecutions).toHaveBeenCalledWith('p1');
    const state = usePlaybookStore.getState();
    expect(state.executionCache).not.toHaveProperty('e1');
    expect(state.executionCache).not.toHaveProperty('e2');
    expect(state.executionHistory).toEqual([{ id: 'e3', playbookId: 'p2' }]);
    expect(state.executionHistoryByPlaybook.p1).toEqual([]);
    expect(state.currentExecution).toBeNull();
    expect(state.executionPanelOpen).toBe(false);
  });

  it('deleteExecution calls api and removes from cache', async () => {
    apiMock.deleteExecution.mockResolvedValueOnce(undefined);

    usePlaybookStore.setState({
      currentExecution: { id: 'e1', playbookId: 'p1', status: 'failed' } as any,
      executionCache: { e1: { id: 'e1', playbookId: 'p1' } as any, e2: { id: 'e2', playbookId: 'p2' } as any },
      executionHistory: [{ id: 'e1', playbookId: 'p1' } as any, { id: 'e2', playbookId: 'p2' } as any],
      executionHistoryByPlaybook: {
        p1: [{ id: 'e1', playbookId: 'p1' } as any],
        p2: [{ id: 'e2', playbookId: 'p2' } as any],
      },
      executionPanelOpen: true,
    });

    await usePlaybookStore.getState().deleteExecution('p1', 'e1');

    expect(apiMock.deleteExecution).toHaveBeenCalledWith('p1', 'e1');
    const state = usePlaybookStore.getState();
    expect(state.executionCache).not.toHaveProperty('e1');
    expect(state.executionCache).toHaveProperty('e2');
    expect(state.executionHistory).toEqual([{ id: 'e2', playbookId: 'p2' }]);
    expect(state.executionHistoryByPlaybook.p1).toEqual([]);
    expect(state.currentExecution).toBeNull();
    expect(state.executionPanelOpen).toBe(false);
  });

  it('setExecutionPanelOpen toggles panel state', () => {
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
    usePlaybookStore.getState().setExecutionPanelOpen(true);
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(true);
    usePlaybookStore.getState().setExecutionPanelOpen(false);
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
  });

  it('updates page mode directly', () => {
    usePlaybookStore.getState().setPageMode('run');
    const state = usePlaybookStore.getState();
    expect(state.pageMode).toBe('run');
  });

  it('onExecutionStart auto-opens panel when viewing the same playbook', () => {
    const playbook = makePlaybook({ id: 'p1' });
    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false });
    usePlaybookStore.getState().onExecutionStart({
      executionId: 'e1',
      playbookId: 'p1',
      executionNumber: 1,
      status: 'running',
      singleStepTaskId: 'task-2',
      reflectionEnabled: false,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 93,
      advisorAutopilotMaxTurns: 5,
      taskResults: [],
    });
    const state = usePlaybookStore.getState();
    expect(state.executionPanelOpen).toBe(true);
    expect(state.currentExecution).toMatchObject({
      singleStepTaskId: 'task-2',
      reflectionEnabled: false,
      advisorScoringMode: 'heuristic',
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 93,
      advisorAutopilotMaxTurns: 5,
    });
    expect(state.executionHistory[0]).toMatchObject({ singleStepTaskId: 'task-2' });
  });

  it('onExecutionStart does NOT open panel for a different playbook', () => {
    const playbook = makePlaybook({ id: 'p1' });
    usePlaybookStore.setState({ currentPlaybook: playbook, executionPanelOpen: false });
    usePlaybookStore.getState().onExecutionStart({
      executionId: 'e1',
      playbookId: 'other-playbook',
      executionNumber: 1,
      status: 'running',
      taskResults: [],
    });
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(false);
    expect(usePlaybookStore.getState().currentExecution).toBeNull();
  });

  it('onInterrupt auto-opens panel', () => {
    const execution = makeExecution({ id: 'e1', playbookId: 'p1', taskResults: [{ ...makeExecution().taskResults[0], taskId: 'task-1', components: [] }] });
    usePlaybookStore.setState({
      executionCache: { e1: execution },
      currentExecution: execution,
      executionHistory: [makeExecutionSummary({ id: 'e1', playbookId: 'p1' })],
      executingPlaybookIds: ['p1'],
      executionPanelOpen: false,
    });
    usePlaybookStore.getState().onInterrupt({
      executionId: 'e1',
      taskId: 'task-1',
      type: 'approval_request',
      message: 'Approve?',
      threadId: 'th-1',
    });
    expect(usePlaybookStore.getState().executionPanelOpen).toBe(true);
  });

  it('keeps the execution panel closed while selecting a node in design mode', () => {
    const playbook = makePlaybook({ id: 'p1', tasks: [makeTask({ id: 't1' })] });
    const execution = makeExecution({ id: 'e1', playbookId: 'p1' });

    usePlaybookStore.setState({
      currentPlaybook: playbook,
      currentExecution: execution,
      executionPanelOpen: false,
      pageMode: 'design',
      selectedStepId: null,
    });

    usePlaybookStore.getState().selectStep('t1');

    const state = usePlaybookStore.getState();
    expect(state.selectedStepId).toBe('t1');
    expect(state.pageMode).toBe('design');
    expect(state.executionPanelOpen).toBe(false);
  });

  it('openExecutionDetailTab opens panel in run mode with the specified tab and step', () => {
    usePlaybookStore.setState({
      executionPanelOpen: false,
      pageMode: 'design',
      executionDetailTab: 'results',
      selectedStepId: null,
    });

    usePlaybookStore.getState().openExecutionDetailTab('judge', 'task-1');

    const state = usePlaybookStore.getState();
    expect(state.executionDetailTab).toBe('judge');
    expect(state.executionPanelOpen).toBe(true);
    expect(state.pageMode).toBe('run');
    expect(state.selectedStepId).toBe('task-1');
    expect(state.workspaceExplorerOpen).toBe(false);
    expect(state.connectorSidebarOpen).toBe(false);
    expect(state.nodeEditorOpen).toBe(false);
  });

  it('openExecutionDetailTab works without a taskId', () => {
    usePlaybookStore.setState({
      executionPanelOpen: false,
      executionDetailTab: 'results',
      selectedStepId: 'existing-step',
    });

    usePlaybookStore.getState().openExecutionDetailTab('evaluation');

    const state = usePlaybookStore.getState();
    expect(state.executionDetailTab).toBe('evaluation');
    expect(state.executionPanelOpen).toBe(true);
    expect(state.selectedStepId).toBe('existing-step');
  });

  it('prefers terminal api execution state over cached running state', async () => {
    const cached = makeExecution({
      id: 'e1',
      status: 'running',
      taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'running' }],
      updatedAt: '2025-01-01T00:00:10.000Z',
    });
    usePlaybookStore.setState({
      executionCache: { e1: cached },
      selectedStepId: null,
      executingPlaybookIds: ['p1'],
    });

    apiMock.getExecution.mockResolvedValueOnce(
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'completed',
        updatedAt: '2025-01-01T00:00:20.000Z',
        completedAt: '2025-01-01T00:00:20.000Z',
        taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'completed' }],
      }),
    );

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');
    const state = usePlaybookStore.getState();
    expect(state.currentExecution?.status).toBe('completed');
    expect(state.currentExecution?.taskResults[0].status).toBe('completed');
    expect(state.executingPlaybookIds).not.toContain('p1');
  });

  it('keeps a newer optimistic running execution over an older completed fetch', async () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      startedAt: '2025-01-01T00:00:15.000Z',
      updatedAt: '2025-01-01T00:00:15.000Z',
      taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'running', startedAt: '2025-01-01T00:00:15.000Z' }],
    });
    usePlaybookStore.setState({
      executionCache: { e1: cached },
      currentExecution: cached,
      selectedStepId: null,
      executingPlaybookIds: ['p1'],
    });

    apiMock.getExecution.mockResolvedValueOnce(
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'completed',
        updatedAt: '2025-01-01T00:00:10.000Z',
        completedAt: '2025-01-01T00:00:10.000Z',
        taskResults: [{ ...makeExecution().taskResults[0], taskId: 't1', status: 'completed', completedAt: '2025-01-01T00:00:10.000Z' }],
      }),
    );

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');
    const state = usePlaybookStore.getState();
    expect(state.currentExecution?.status).toBe('running');
    expect(state.currentExecution?.taskResults[0].status).toBe('running');
    expect(state.executingPlaybookIds).toContain('p1');
  });

  it('preserves iterator childResults from SSE when fetchExecution returns a parent result without nested iterations', async () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      taskResults: [
        {
          ...makeExecution().taskResults[0],
          taskId: 'iterator-1',
          status: 'running',
          iteratorIterations: [
            {
              index: 0,
              status: 'running',
              itemPreview: null,
              output: null,
              error: null,
              artifacts: [],
              childResults: [
                { taskId: 'child-1', taskTitle: 'Child 1', status: 'running', output: null, error: null, artifacts: [] },
              ],
            },
          ],
        },
        {
          ...makeExecution().taskResults[1],
          taskId: 'child-1',
          status: 'completed',
        },
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: cached },
      currentExecution: cached,
    });

    apiMock.getExecution.mockResolvedValueOnce(
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'running',
        updatedAt: '2025-01-01T00:00:20.000Z',
        taskResults: [
          {
            ...makeExecution().taskResults[0],
            taskId: 'iterator-1',
            status: 'running',
            iteratorIterations: [],
          },
          {
            ...makeExecution().taskResults[1],
            taskId: 'child-1',
            status: 'completed',
          },
        ],
      }),
    );

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');

    const iteratorResult = usePlaybookStore.getState().executionCache.e1.taskResults.find((tr) => tr.taskId === 'iterator-1');
    expect(iteratorResult?.iteratorIterations).toHaveLength(1);
    expect(iteratorResult?.iteratorIterations?.[0].childResults).toEqual([
      expect.objectContaining({ taskId: 'child-1', status: 'running' }),
    ]);
  });

  it('preserves iterator childResults from SSE when hydrating active executions with thinner parent data', () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      taskResults: [
        {
          ...makeExecution().taskResults[0],
          taskId: 'iterator-1',
          status: 'running',
          iteratorIterations: [
            {
              index: 0,
              status: 'running',
              itemPreview: null,
              output: null,
              error: null,
              artifacts: [],
              childResults: [
                { taskId: 'child-1', taskTitle: 'Child 1', status: 'running', output: null, error: null, artifacts: [] },
              ],
            },
          ],
        },
        {
          ...makeExecution().taskResults[1],
          taskId: 'child-1',
          status: 'completed',
        },
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: cached },
      currentPlaybook: makePlaybook({
        id: 'p1',
        tasks: [
          makeTask({ id: 'iterator-1', taskType: 'iterator' as never }),
          makeTask({ id: 'child-1', containerConfig: { parentIteratorId: 'iterator-1' } }),
        ],
      }),
    });

    usePlaybookStore.getState().hydrateActiveExecutions([
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'running',
        updatedAt: '2025-01-01T00:00:20.000Z',
        taskResults: [
          {
            ...makeExecution().taskResults[0],
            taskId: 'iterator-1',
            status: 'running',
            iteratorIterations: [],
          },
          {
            ...makeExecution().taskResults[1],
            taskId: 'child-1',
            status: 'completed',
          },
        ],
      }),
    ]);

    const iteratorResult = usePlaybookStore.getState().executionCache.e1.taskResults.find((tr) => tr.taskId === 'iterator-1');
    expect(iteratorResult?.iteratorIterations).toHaveLength(1);
    expect(iteratorResult?.iteratorIterations?.[0].childResults).toEqual([
      expect.objectContaining({ taskId: 'child-1', status: 'running' }),
    ]);
  });

  it('preserves cached iterator childResults without keeping a stale running status during fetchExecution', async () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      taskResults: [
        {
          ...makeExecution().taskResults[0],
          taskId: 'iterator-1',
          status: 'running',
          iteratorIterations: [
            {
              index: 0,
              status: 'running',
              itemPreview: null,
              output: null,
              error: null,
              artifacts: [],
              childResults: [
                { taskId: 'child-1', taskTitle: 'Child 1', status: 'running', output: null, error: null, artifacts: [] },
              ],
            },
          ],
        },
      ],
    });

    usePlaybookStore.setState({ executionCache: { e1: cached }, currentExecution: cached });
    apiMock.getExecution.mockResolvedValueOnce(
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'completed',
        updatedAt: '2025-01-01T00:00:20.000Z',
        taskResults: [
          {
            ...makeExecution().taskResults[0],
            taskId: 'iterator-1',
            status: 'completed',
            iteratorIterations: [],
          },
        ],
      }),
    );

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');

    const iteratorResult = usePlaybookStore.getState().executionCache.e1.taskResults.find((tr) => tr.taskId === 'iterator-1');
    expect(iteratorResult?.status).toBe('completed');
    expect(iteratorResult?.iteratorIterations?.[0].childResults).toEqual([
      expect.objectContaining({ taskId: 'child-1', status: 'running' }),
    ]);
  });

  it('preserves cached iterator childResults without keeping a stale running status during hydration', () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'running',
      taskResults: [
        {
          ...makeExecution().taskResults[0],
          taskId: 'iterator-1',
          status: 'running',
          iteratorIterations: [
            {
              index: 0,
              status: 'running',
              itemPreview: null,
              output: null,
              error: null,
              artifacts: [],
              childResults: [
                { taskId: 'child-1', taskTitle: 'Child 1', status: 'running', output: null, error: null, artifacts: [] },
              ],
            },
          ],
        },
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: cached },
      currentPlaybook: makePlaybook({ id: 'p1' }),
    });

    usePlaybookStore.getState().hydrateActiveExecutions([
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'completed',
        updatedAt: '2025-01-01T00:00:20.000Z',
        taskResults: [
          {
            ...makeExecution().taskResults[0],
            taskId: 'iterator-1',
            status: 'completed',
            iteratorIterations: [],
          },
        ],
      }),
    ]);

    const iteratorResult = usePlaybookStore.getState().executionCache.e1.taskResults.find((tr) => tr.taskId === 'iterator-1');
    expect(iteratorResult?.status).toBe('completed');
    expect(iteratorResult?.iteratorIterations?.[0].childResults).toEqual([
      expect.objectContaining({ taskId: 'child-1', status: 'running' }),
    ]);
  });

  it('matches cached judge state by taskId and iteration during fetchExecution', async () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } } as any,
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'evaluating', judgeResult: null } as any,
      ],
    });

    usePlaybookStore.setState({ executionCache: { e1: cached }, currentExecution: cached });

    apiMock.getExecution.mockResolvedValueOnce(makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } } as any,
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 92 } } as any,
      ],
    }));

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');

    const taskResults = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(taskResults[0]).toMatchObject({ iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } });
    expect(taskResults[1]).toMatchObject({ iteration: 1, judgeStatus: 'evaluated', judgeResult: { overallScore: 92 } });
  });

  it('treats undefined and zero iteration as the same base task during fetchExecution', async () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: undefined, status: 'completed', judgeStatus: 'evaluating', judgeResult: null } as any,
      ],
    });

    usePlaybookStore.setState({ executionCache: { e1: cached }, currentExecution: cached });

    apiMock.getExecution.mockResolvedValueOnce(makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 88 } } as any,
      ],
    }));

    await usePlaybookStore.getState().fetchExecution('p1', 'e1');

    const taskResults = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(taskResults).toHaveLength(1);
    expect(taskResults[0]).toMatchObject({ taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 88 } });
  });

  it('matches cached judge state by taskId and iteration during active hydration', () => {
    const cached = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } } as any,
        { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'evaluating', judgeResult: null } as any,
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: cached },
      currentPlaybook: makePlaybook({ id: 'p1' }),
    });

    usePlaybookStore.getState().hydrateActiveExecutions([
      makeExecution({
        id: 'e1',
        playbookId: 'p1',
        status: 'completed',
        taskResults: [
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } } as any,
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'evaluated', judgeResult: { overallScore: 92 } } as any,
        ],
      }),
    ]);

    const taskResults = usePlaybookStore.getState().executionCache.e1.taskResults;
    expect(taskResults[0]).toMatchObject({ iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } });
    expect(taskResults[1]).toMatchObject({ iteration: 1, judgeStatus: 'evaluated', judgeResult: { overallScore: 92 } });
  });

  it('keeps hydrated pending-approval executions active after reconnect', () => {
    usePlaybookStore.setState({ currentPlaybook: makePlaybook({ id: 'p1' }) });

    usePlaybookStore.getState().hydrateActiveExecutions([
      makeExecution({
        id: 'e-pending',
        playbookId: 'p1',
        status: 'pending_approval' as any,
        interruptPayload: {
          type: 'human_approval',
          taskId: 'task-7',
          message: 'Need approval',
          iteration: 2,
        } as any,
        waitingForHumanInput: true,
        currentInterruptTaskId: 'task-7',
        taskResults: [],
      }),
    ]);

    const state = usePlaybookStore.getState();
    expect(state.executingPlaybookIds).toContain('p1');
    expect(state.currentExecution).toMatchObject({
      status: 'pending_approval',
      waitingForHumanInput: true,
      currentInterruptTaskId: 'task-7',
      interruptPayload: expect.objectContaining({ taskId: 'task-7' }),
    });
  });

  it('calls the targeted resume endpoint when resuming from a step', async () => {
    apiMock.resumePlaybookFromStep.mockResolvedValueOnce({ status: 'running', executionId: 'e1' });

    const execution = makeExecution({
      id: 'e1',
      playbookId: 'p1',
      status: 'completed',
      taskResults: [
        {
          taskId: 't1',
          nodeTitle: 'Step 1',
          agentName: 'A1',
          order: 1,
          status: 'completed',
          output: 'done',
          error: null,
          durationMs: 100,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:01.000Z',
        },
        {
          taskId: 't2',
          nodeTitle: 'Step 2',
          agentName: 'A2',
          order: 2,
          status: 'completed',
          output: 'stale current',
          error: null,
          durationMs: 100,
          startedAt: '2025-01-01T00:00:02.000Z',
          completedAt: '2025-01-01T00:00:03.000Z',
          isStale: true,
          staleReason: 'Invalidated',
          invalidatedByTaskId: 't1',
        },
        {
          taskId: 't3',
          nodeTitle: 'Step 3',
          agentName: 'A3',
          order: 3,
          status: 'completed',
          output: 'stale downstream',
          error: null,
          durationMs: 100,
          startedAt: '2025-01-01T00:00:04.000Z',
          completedAt: '2025-01-01T00:00:05.000Z',
          isStale: true,
          staleReason: 'Invalidated',
          invalidatedByTaskId: 't2',
        },
      ],
    });

    usePlaybookStore.setState({
      executionCache: { e1: execution },
      currentExecution: execution,
      selectedStepId: 't1',
    });

    await usePlaybookStore.getState().resumeFromStep('p1', 'e1', 't2');

    expect(apiMock.resumePlaybookFromStep).toHaveBeenCalledWith('p1', 'e1', {
      taskId: 't2',
      streaming: false,
    });
  });

  it('calls the targeted rerun endpoint when rerunning a step', async () => {
    apiMock.rerunPlaybookStep.mockResolvedValueOnce({ status: 'running', executionId: 'e1' });

    await usePlaybookStore.getState().rerunStepInExecution('p1', 'e1', 't1');

    expect(apiMock.rerunPlaybookStep).toHaveBeenCalledWith('p1', 'e1', {
      taskId: 't1',
      runEvaluation: false,
      executionMode: 'live',
      streaming: false,
      runNodeReflection: true,
      advisorAutopilotEnabled: false,
      advisorAutopilotTargetScore: undefined,
      advisorAutopilotMaxTurns: undefined,
      skipStepExecution: false,
    });
  });

  // ===== Schedule =====

  it('upsertPlaybookTriggerSchedule updates currentPlaybook and playbooks list', async () => {
    const schedule = { enabled: true, timezone: 'UTC', type: 'daily' as const, daily: { timesLocal: ['09:00'] }, weekly: null, monthly: null, advanced: null, lastScheduledRunAt: null };
    const playbook = makePlaybook({ id: 'p1', executionSchedule: schedule });

    apiMock.upsertPlaybookTriggerSchedule.mockResolvedValueOnce(playbook);
    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1', executionSchedule: null }),
      playbooks: [
        { id: 'p1', name: 'PB', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: false, lastExecutionAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
        { id: 'p2', name: 'Other', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: false, lastExecutionAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ],
    });

    await usePlaybookStore.getState().upsertPlaybookTriggerSchedule('p1', {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });

    const state = usePlaybookStore.getState();
    expect(state.triggerSaving).toBe(false);
    expect(state.currentPlaybook?.executionSchedule?.enabled).toBe(true);
    expect(state.playbooks.find((p) => p.id === 'p1')?.scheduleEnabled).toBe(true);
    expect(state.playbooks.find((p) => p.id === 'p2')?.scheduleEnabled).toBe(false);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('upsertPlaybookTriggerSchedule does not remap playbooks when playbook not in list', async () => {
    const schedule = { enabled: true, timezone: 'UTC', type: 'daily' as const, daily: { timesLocal: ['09:00'] }, weekly: null, monthly: null, advanced: null, lastScheduledRunAt: null };
    const playbook = makePlaybook({ id: 'p1', executionSchedule: schedule });

    apiMock.upsertPlaybookTriggerSchedule.mockResolvedValueOnce(playbook);
    const originalPlaybooks = [{ id: 'p2', name: 'Other', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: false, lastExecutionAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01' }];
    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1', executionSchedule: null }),
      playbooks: originalPlaybooks,
    });

    await usePlaybookStore.getState().upsertPlaybookTriggerSchedule('p1', {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['09:00'] },
    });

    const state = usePlaybookStore.getState();
    expect(state.playbooks).toBe(originalPlaybooks);
  });

  it('upsertPlaybookTriggerSchedule sets triggerError on failure', async () => {
    apiMock.upsertPlaybookTriggerSchedule.mockRejectedValueOnce(new Error('server error'));
    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1' }),
      playbooks: [],
    });

    await expect(
      usePlaybookStore.getState().upsertPlaybookTriggerSchedule('p1', { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } }),
    ).rejects.toThrow('server error');

    const state = usePlaybookStore.getState();
    expect(state.triggerSaving).toBe(false);
    expect(state.triggerError).toBeTruthy();
    expect(handleApiErrorMock).toHaveBeenCalled();
  });

  it('clearPlaybookTriggerSchedule clears schedule and sets scheduleEnabled to false', async () => {
    const playbook = makePlaybook({ id: 'p1', executionSchedule: null });
    apiMock.clearPlaybookTriggerSchedule.mockResolvedValueOnce(playbook);

    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1', executionSchedule: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] }, weekly: null, monthly: null, advanced: null, lastScheduledRunAt: null } }),
      playbooks: [
        { id: 'p1', name: 'PB', description: '', taskCount: 1, isFavorite: false, scheduleEnabled: true, lastExecutionAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01' },
      ],
    });

    await usePlaybookStore.getState().clearPlaybookTriggerSchedule('p1');

    const state = usePlaybookStore.getState();
    expect(state.triggerSaving).toBe(false);
    expect(state.currentPlaybook?.executionSchedule).toBeNull();
    expect(state.playbooks[0].scheduleEnabled).toBe(false);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('clearPlaybookTriggerSchedule sets triggerError on failure', async () => {
    apiMock.clearPlaybookTriggerSchedule.mockRejectedValueOnce(new Error('server error'));
    usePlaybookStore.setState({
      currentPlaybook: makePlaybook({ id: 'p1' }),
      playbooks: [],
    });

    await expect(
      usePlaybookStore.getState().clearPlaybookTriggerSchedule('p1'),
    ).rejects.toThrow('server error');

    const state = usePlaybookStore.getState();
    expect(state.triggerSaving).toBe(false);
    expect(state.triggerError).toBeTruthy();
    expect(handleApiErrorMock).toHaveBeenCalled();
  });

  describe('fetchRepeatability', () => {
    it('fetches and stores repeatability summary', async () => {
      const mockSummary = {
        playbookId: 'p1',
        overallAverageMatchScore: 82,
        totalIterations: 5,
        evaluatedIterations: 3,
        passedIterations: 2,
        iterations: [],
        generatedAt: '2026-04-26T20:00:00.000Z',
      };
      apiMock.getPlaybookRepeatability.mockResolvedValueOnce(mockSummary);

      const result = await usePlaybookStore.getState().fetchRepeatability('p1', 5, 0);

      expect(apiMock.getPlaybookRepeatability).toHaveBeenCalledWith('p1', 5, 0);
      expect(result.overallAverageMatchScore).toBe(82);
      expect(usePlaybookStore.getState().repeatability).toEqual(mockSummary);
      expect(usePlaybookStore.getState().repeatabilityLoading).toBe(false);
    });

    it('sets loading state and clears on success', async () => {
      apiMock.getPlaybookRepeatability.mockResolvedValueOnce({ playbookId: 'p1', overallAverageMatchScore: null, totalIterations: 0, evaluatedIterations: 0, passedIterations: 0, iterations: [], generatedAt: '' });

      await usePlaybookStore.getState().fetchRepeatability('p1');

      expect(usePlaybookStore.getState().repeatabilityLoading).toBe(false);
    });

    it('clears loading on failure and calls handleApiError', async () => {
      apiMock.getPlaybookRepeatability.mockRejectedValueOnce(new Error('network'));

      await expect(
        usePlaybookStore.getState().fetchRepeatability('p1'),
      ).rejects.toThrow('network');

      expect(usePlaybookStore.getState().repeatabilityLoading).toBe(false);
      expect(handleApiErrorMock).toHaveBeenCalled();
    });
  });

  it('updates only the targeted iteration during advisor evaluation', async () => {
    apiMock.runAdvisorEvaluation.mockResolvedValueOnce({
      executionId: 'exec-1',
      taskId: 'task-1',
      taskResult: {
        taskId: 'task-1',
        iteration: 1,
        status: 'completed',
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 92 },
        judgeError: null,
        judgeScoringMode: 'heuristic',
        judgeHistory: [{ id: 'judge-1' }],
      },
    });

    usePlaybookStore.setState({
      currentExecution: makeExecution({
        id: 'exec-1',
        status: 'completed',
        taskResults: [
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
        ] as any,
      }),
      executionCache: {
        'exec-1': makeExecution({
          id: 'exec-1',
          status: 'completed',
          taskResults: [
            { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
            { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
          ] as any,
        }),
      },
    });

    await usePlaybookStore.getState().runAdvisorEvaluation('exec-1', 'task-1', 1);

    const taskResults = usePlaybookStore.getState().currentExecution?.taskResults || [];
    expect(taskResults[0]).toMatchObject({ iteration: 0, judgeStatus: 'idle', judgeResult: null });
    expect(taskResults[1]).toMatchObject({
      iteration: 1,
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 92 },
      judgeScoringMode: 'heuristic',
    });
  });

  it('marks only the targeted iteration as failed when advisor evaluation errors', async () => {
    apiMock.runAdvisorEvaluation.mockRejectedValueOnce(new Error('advisor failed'));

    usePlaybookStore.setState({
      currentExecution: makeExecution({
        id: 'exec-2',
        status: 'completed',
        taskResults: [
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
          { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
        ] as any,
      }),
      executionCache: {
        'exec-2': makeExecution({
          id: 'exec-2',
          status: 'completed',
          taskResults: [
            { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
            { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, status: 'completed', judgeStatus: 'idle', judgeResult: null, judgeError: null },
          ] as any,
        }),
      },
    });

    await expect(usePlaybookStore.getState().runAdvisorEvaluation('exec-2', 'task-1', 1)).rejects.toThrow('advisor failed');

    const taskResults = usePlaybookStore.getState().currentExecution?.taskResults || [];
    expect(taskResults[0]).toMatchObject({ iteration: 0, judgeStatus: 'idle', judgeError: null });
    expect(taskResults[1]).toMatchObject({ iteration: 1, judgeStatus: 'failed', judgeError: 'parseApiError message' });
  });

  describe('clearRepeatability', () => {
    it('resets repeatability state', async () => {
      apiMock.getPlaybookRepeatability.mockResolvedValueOnce({ playbookId: 'p1', overallAverageMatchScore: 90, totalIterations: 1, evaluatedIterations: 1, passedIterations: 1, iterations: [], generatedAt: '' });
      await usePlaybookStore.getState().fetchRepeatability('p1');
      expect(usePlaybookStore.getState().repeatability).not.toBeNull();

      usePlaybookStore.getState().clearRepeatability();
      expect(usePlaybookStore.getState().repeatability).toBeNull();
      expect(usePlaybookStore.getState().repeatabilityLoading).toBe(false);
    });
  });
});
