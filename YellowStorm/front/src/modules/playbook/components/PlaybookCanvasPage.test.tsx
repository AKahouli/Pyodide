import { describe, expect, it, vi } from 'vitest';
import { buildIntentEdgeOptions, buildOverviewResultNodeIds, canAppendIntentEdge, canRunPlaybookInputContract, didCanonicalAssistantCommitSucceed, getInitialPlaybookPageMode, getMissingTaskConfiguration, getPlaybookInputRevisionSyncAction, getPlaybookInputRevisionSyncRequest, getScopedConstructionDiagnostics, hydrateAssistantOperationHandoff, isPlaybookRouteCurrent, isTaskConfiguredForExecution, loadLatestPlaybookAssistantHistory, pruneUnreachableDataBindings, recoverPlaybookInputConfigurationConflict, remapRouterConditionSourceNodes, replacePlaybookInputBinding, resolveDiagnosticNodeId, resolveIntentNodeSemantics, runPlaybookInputRevisionSync, savePlaybookInputConfiguration, shouldApplyInitialAutoLayout, shouldAutoLayoutAfterConstruction, shouldBlockAssistantNavigation, shouldBlockCanvasMutationShortcut, shouldClearConstructionDiagnostics, shouldConsumeAssistantOperationHandoff, shouldEnableCanvasNodeDragging, shouldPauseAssistantPersistence, shouldRenderPlaybookAssistant, shouldUsePlaybookMcpAssistant, updateScopedConstructionDiagnostics, type PlaybookInputRevisionSyncState } from './PlaybookCanvasPage';
import { resolveCanvasNodeSelection } from '../utils/playbook-canvas-selection';
import { buildCanvasJudgeStateMap, hasPendingJudgeEvaluations } from '../utils/playbook-canvas-status';
import { makeExecution } from '../test-utils';
import type { Playbook, PlaybookTask } from '../types';

const makeTask = (overrides: Partial<PlaybookTask> = {}) => ({
  id: 'task-1',
  title: 'Task',
  description: '',
  nodeType: 'agent',
  taskType: 'generic',
  executionMode: 'agent',
  enabled: true,
  assignedAgentId: 'agent-1',
  ...overrides,
}) as PlaybookTask;

describe('savePlaybookInputConfiguration', () => {
  it('uses the current store revision and keeps the dialog open when save leaves a dirty draft', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const refetchContract = vi.fn().mockResolvedValue(undefined);

    await expect(savePlaybookInputConfiguration(save, () => true, refetchContract)).resolves.toBe(false);

    expect(save).toHaveBeenCalledWith({ reason: 'manual' });
    expect(refetchContract).not.toHaveBeenCalled();
  });

  it('refreshes the contract only after a successful clean save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const refetchContract = vi.fn().mockResolvedValue(undefined);

    await expect(savePlaybookInputConfiguration(save, () => false, refetchContract)).resolves.toBe(true);

    expect(refetchContract).toHaveBeenCalledOnce();
  });

  it('recovers a manual revision conflict instead of reporting a generic save failure', async () => {
    const conflict = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { success: false, error: { code: 'ERR_1005', message: 'Conflict', statusCode: 409 } },
      },
    };
    const recoverConflict = vi.fn().mockResolvedValue(undefined);

    await expect(savePlaybookInputConfiguration(
      vi.fn().mockRejectedValue(conflict),
      () => true,
      vi.fn(),
      recoverConflict,
    )).resolves.toBe(false);

    expect(recoverConflict).toHaveBeenCalledOnce();
  });
});

describe('Playbook input configuration conflict recovery', () => {
  const input = {
    id: 'task-1:destination', taskId: 'task-1', taskTitle: 'Save report',
    portId: 'destination', label: 'Destination', artifactKind: 'data' as const,
    required: true as const, scope: 'configuration' as const,
    binding: { kind: 'constant' as const }, acceptedSources: ['workspace' as const],
    readiness: 'configured' as const,
  };

  it('loads the latest Playbook before its matching contract and retains the input for explicit retry', async () => {
    const calls: string[] = [];
    let playbook = { id: 'playbook-1', definitionRevision: 4 } as Playbook;
    const result = await recoverPlaybookInputConfigurationConflict({
      playbookId: 'playbook-1',
      attemptedRevision: 3,
      inputId: input.id,
      fetchPlaybook: vi.fn(async () => { calls.push('playbook'); return { ...playbook, definitionRevision: 5 }; }),
      commitPlaybook: vi.fn((refreshed) => { playbook = refreshed; return true; }),
      refetchContract: vi.fn(async () => {
        calls.push('contract');
        return { data: { playbookId: 'playbook-1', definitionRevision: 5, graphValid: true, configurationReady: true, runtimeInputCount: 0, invalidInputCount: 0, inputs: [input] } };
      }),
      isRouteCurrent: () => true,
    });

    expect(calls).toEqual(['playbook', 'contract']);
    expect(result).toEqual({ status: 'recovered', input });
  });

  it('does not let a late recovery for Playbook A replace Playbook B after navigation', async () => {
    let routeCurrent = true;
    let currentPlaybook = { id: 'playbook-1', definitionRevision: 3 } as Playbook;
    let resolvePlaybook!: (playbook: Playbook) => void;
    const pendingPlaybook = new Promise<Playbook>((resolve) => { resolvePlaybook = resolve; });
    const refetchContract = vi.fn();
    const recovery = recoverPlaybookInputConfigurationConflict({
      playbookId: 'playbook-1', attemptedRevision: 3, inputId: input.id,
      fetchPlaybook: vi.fn(() => pendingPlaybook),
      commitPlaybook: vi.fn((refreshed) => {
        if (!routeCurrent || currentPlaybook.id !== 'playbook-1') return false;
        currentPlaybook = refreshed;
        return true;
      }),
      refetchContract,
      isRouteCurrent: () => routeCurrent,
    });

    routeCurrent = false;
    currentPlaybook = { ...currentPlaybook, id: 'playbook-2', definitionRevision: 7 };
    resolvePlaybook({ ...currentPlaybook, id: 'playbook-1', definitionRevision: 4 });

    await expect(recovery).resolves.toEqual({ status: 'failed' });
    expect(currentPlaybook.id).toBe('playbook-2');
    expect(refetchContract).not.toHaveBeenCalled();
  });

  it('replaces only the target binding on retry and preserves competing server bindings', () => {
    const competingBinding = { id: 'server-binding', targetNode: 'task-2', targetPort: 'source', sourceKind: 'constant' as const, constantValue: 'server value' };
    const staleTarget = { id: 'old-target', targetNode: input.taskId, targetPort: input.portId, sourceKind: 'constant' as const, constantValue: { id: 'old' } };

    expect(replacePlaybookInputBinding([competingBinding, staleTarget], input, { id: 'new' })).toEqual([
      competingBinding,
      expect.objectContaining({ targetNode: input.taskId, targetPort: input.portId, constantValue: { id: 'new' } }),
    ]);
  });
});

describe('Playbook input dialog guards', () => {
  const readyContract = {
    configurationReady: true,
    definitionRevision: 4,
    graphValid: true,
    invalidInputCount: 0,
  };

  it('allows runs only for a clean saved playbook at the contract revision', () => {
    expect(canRunPlaybookInputContract(false, false, readyContract, 4)).toBe(true);
    expect(canRunPlaybookInputContract(true, false, readyContract, 4)).toBe(false);
    expect(canRunPlaybookInputContract(false, true, readyContract, 4)).toBe(false);
    expect(canRunPlaybookInputContract(false, false, { ...readyContract, definitionRevision: 3 }, 4)).toBe(false);
  });

  it('blocks every entry point for an invalid or configuration-incomplete contract', () => {
    expect(canRunPlaybookInputContract(false, false, { ...readyContract, graphValid: false }, 4)).toBe(false);
    expect(canRunPlaybookInputContract(false, false, { ...readyContract, configurationReady: false }, 4)).toBe(false);
    expect(canRunPlaybookInputContract(false, false, { ...readyContract, invalidInputCount: 1 }, 4)).toBe(false);
  });

  it('reconciles contract and playbook revisions in the correct direction', () => {
    expect(getPlaybookInputRevisionSyncAction(3, 4)).toBe('contract');
    expect(getPlaybookInputRevisionSyncAction(5, 4)).toBe('playbook');
    expect(getPlaybookInputRevisionSyncAction(4, 4)).toBe('none');
  });

  it('builds directional synchronization requests only when refresh is safe', () => {
    expect(getPlaybookInputRevisionSyncRequest('playbook-a', 3, 4, false)).toEqual({ action: 'contract', key: 'playbook-a:contract:3:4' });
    expect(getPlaybookInputRevisionSyncRequest('playbook-a', 5, 4, false)).toEqual({ action: 'playbook', key: 'playbook-a:playbook:5:4' });
    expect(getPlaybookInputRevisionSyncRequest('playbook-a', 5, 4, true)).toBeNull();
    expect(getPlaybookInputRevisionSyncRequest('playbook-a', 4, 4, false)).toBeNull();
  });

  it.each([
    ['contract', 'playbook-a:contract:3:4'],
    ['playbook', 'playbook-a:playbook:5:4'],
  ])('retries failed %s synchronization without duplicating an in-flight request', async (_action, key) => {
    const state: PlaybookInputRevisionSyncState = { inFlightKey: null, completedKey: null, failuresByKey: {} };
    let resolveFirst!: (successful: boolean) => void;
    const first = runPlaybookInputRevisionSync(
      state,
      { key },
      () => new Promise<boolean>((resolve) => { resolveFirst = resolve; }),
    );

    await expect(runPlaybookInputRevisionSync(state, { key }, async () => true)).resolves.toBe('skipped');
    resolveFirst(false);
    await expect(first).resolves.toBe('failed');
    await expect(runPlaybookInputRevisionSync(state, { key }, async () => true)).resolves.toBe('succeeded');
    await expect(runPlaybookInputRevisionSync(state, { key }, async () => true)).resolves.toBe('skipped');
  });

  it('does not carry completed synchronization state across Playbook routes', async () => {
    const playbookAState: PlaybookInputRevisionSyncState = { inFlightKey: null, completedKey: null, failuresByKey: {} };
    const requestA = getPlaybookInputRevisionSyncRequest('playbook-a', 5, 4, false)!;
    const requestB = getPlaybookInputRevisionSyncRequest('playbook-b', 5, 4, false)!;
    await expect(runPlaybookInputRevisionSync(playbookAState, requestA, async () => true)).resolves.toBe('succeeded');

    const playbookBState: PlaybookInputRevisionSyncState = { inFlightKey: null, completedKey: null, failuresByKey: {} };
    await expect(runPlaybookInputRevisionSync(playbookBState, requestB, async () => true)).resolves.toBe('succeeded');
    expect(requestB.key).not.toBe(requestA.key);
  });
});

describe('isTaskConfiguredForExecution', () => {
  it('identifies every missing setting on an enabled step', () => {
    expect(getMissingTaskConfiguration(makeTask({ assignedAgentId: null }))).toEqual(['agent']);
    expect(getMissingTaskConfiguration(makeTask({ nodeType: 'action', selectedAction: undefined }))).toEqual(['action']);
    expect(getMissingTaskConfiguration(makeTask({ nodeType: 'iterator', iteratorConfig: undefined }))).toEqual(['iteratorSource']);
    expect(getMissingTaskConfiguration(makeTask({ nodeType: 'evaluation', assignedAgentId: null, evaluationConfig: undefined })))
      .toEqual(['agent', 'evaluationExpectation']);
    expect(getMissingTaskConfiguration(makeTask({ enabled: false, assignedAgentId: null }))).toEqual([]);
  });
  it('requires an assigned agent for enabled agent tasks', () => {
    expect(isTaskConfiguredForExecution(makeTask())).toBe(true);
    expect(isTaskConfiguredForExecution(makeTask({ assignedAgentId: undefined }))).toBe(false);
    expect(isTaskConfiguredForExecution(makeTask({ assignedAgentId: undefined, enabled: false }))).toBe(true);
  });

  it('uses effective action type even when legacy execution mode says agent', () => {
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'action', executionMode: 'agent', assignedAgentId: undefined, selectedAction: 'send' }))).toBe(true);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'action', executionMode: 'agent', selectedAction: undefined }))).toBe(false);
  });

  it('requires evaluation, iterator, and structural configuration by node type', () => {
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'evaluation', evaluationConfig: { expectation: 'Accurate' } as PlaybookTask['evaluationConfig'] }))).toBe(true);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'evaluation', evaluationConfig: undefined }))).toBe(false);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'iterator', assignedAgentId: undefined, iteratorConfig: { source: 'items' } as PlaybookTask['iteratorConfig'] }))).toBe(true);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'iterator', iteratorConfig: undefined }))).toBe(false);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'router', assignedAgentId: undefined }))).toBe(true);
    expect(isTaskConfiguredForExecution(makeTask({ nodeType: 'human_approval', assignedAgentId: undefined }))).toBe(true);
  });
});

describe('shouldBlockCanvasMutationShortcut', () => {
  it('blocks undo, redo, cut, and paste shortcuts during direct construction', () => {
    for (const key of ['z', 'y', 'x', 'v']) {
      expect(shouldBlockCanvasMutationShortcut({ key, ctrlKey: true, metaKey: false }, true)).toBe(true);
    }
    expect(shouldBlockCanvasMutationShortcut({ key: 'c', ctrlKey: true, metaKey: false }, true)).toBe(false);
    expect(shouldBlockCanvasMutationShortcut({ key: 'z', ctrlKey: true, metaKey: false }, false)).toBe(false);
  });
});

describe('shouldEnableCanvasNodeDragging', () => {
  it('keeps full-canvas task dragging enabled while runtime projections are visible', () => {
    expect(shouldEnableCanvasNodeDragging(false, false, 'full')).toBe(true);
    expect(shouldEnableCanvasNodeDragging(true, false, 'full')).toBe(false);
    expect(shouldEnableCanvasNodeDragging(false, true, 'full')).toBe(false);
    expect(shouldEnableCanvasNodeDragging(false, false, 'focus')).toBe(false);
  });
});

describe('shouldRenderPlaybookAssistant', () => {
  it('hides the design assistant in monitor view and while an execution is live', () => {
    expect(shouldRenderPlaybookAssistant('design', false, false)).toBe(true);
    expect(shouldRenderPlaybookAssistant('run', false, false)).toBe(false);
    expect(shouldRenderPlaybookAssistant('design', true, false)).toBe(false);
  });

  it('keeps the human response surface available for an interrupted execution', () => {
    expect(shouldRenderPlaybookAssistant('run', true, true)).toBe(true);
  });
});

describe('shouldConsumeAssistantOperationHandoff', () => {
  it('waits for the route playbook to load instead of consuming onto a stale one', () => {
    expect(shouldConsumeAssistantOperationHandoff('playbook-b', 'playbook-a', 'operation-1', null)).toBe(false);
    expect(shouldConsumeAssistantOperationHandoff('playbook-b', undefined, 'operation-1', null)).toBe(false);
    expect(shouldConsumeAssistantOperationHandoff('playbook-b', 'playbook-b', 'operation-1', null)).toBe(true);
  });

  it('ignores handoffs without a route, operation, or already consumed', () => {
    expect(shouldConsumeAssistantOperationHandoff(undefined, 'playbook-a', 'operation-1', null)).toBe(false);
    expect(shouldConsumeAssistantOperationHandoff('playbook-b', 'playbook-b', null, null)).toBe(false);
    expect(shouldConsumeAssistantOperationHandoff('playbook-b', 'playbook-b', 'operation-1', 'operation-1')).toBe(false);
  });
});

describe('pruneUnreachableDataBindings', () => {
  const tasks = [
    { id: 'a', inputPorts: [], outputPorts: [{ id: 'o', artifactKind: 'text' }] },
    { id: 'b', inputPorts: [{ id: 'i', artifactKind: 'text', required: true }], outputPorts: [] },
    { id: 'c', inputPorts: [{ id: 'i', artifactKind: 'text' }], outputPorts: [] },
  ] as any;
  const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target }) as any;

  it('keeps bindings whose source can reach the target and drops the rest', () => {
    const { bindings, dropped } = pruneUnreachableDataBindings(tasks, [edge('a', 'b'), edge('b', 'c')], [
      { sourceKind: 'node-output', sourceNode: 'a', sourcePort: 'o', targetNode: 'b', targetPort: 'i' },
      { sourceKind: 'node-output', sourceNode: 'a', sourcePort: 'o', targetNode: 'c', targetPort: 'i' },
      { sourceKind: 'node-output', sourceNode: 'b', sourcePort: 'o', targetNode: 'a', targetPort: 'i' },
      { sourceKind: 'constant', constantValue: 'x', targetNode: 'c', targetPort: 'i' },
    ] as any);

    expect(bindings.map((b) => b.sourceKind === 'node-output' ? `${b.sourceNode}->${b.targetNode}` : b.sourceKind)).toEqual(['a->b', 'a->c', 'constant']);
    expect(dropped).toEqual(['b.o->a.i']);
  });

  it('keeps reachable bindings after an after-anchor re-route severs a direct edge', () => {
    // zqw95x -> export -> s2l9bl keeps the zqw95x -> s2l9bl binding reachable transitively.
    const { bindings } = pruneUnreachableDataBindings(tasks, [edge('a', 'b'), edge('b', 'c')], [
      { sourceKind: 'node-output', sourceNode: 'a', sourcePort: 'o', targetNode: 'c', targetPort: 'i' },
    ] as any);
    expect(bindings).toHaveLength(1);
  });
});

describe('getInitialPlaybookPageMode', () => {
  it('opens every non-idle execution in Monitor, including runs awaiting approval', () => {
    for (const status of ['queued', 'pending', 'running', 'pending_approval', 'interrupted', 'failed', 'cancelled', 'completed']) {
      expect(getInitialPlaybookPageMode(status)).toBe('run');
    }
    expect(getInitialPlaybookPageMode('idle')).toBe('design');
    expect(getInitialPlaybookPageMode()).toBe('design');
  });
});

describe('canAppendIntentEdge', () => {
  it('blocks Canvas fallback edges with incompatible explicit artifact kinds', () => {
    const source = makeTask({ outputPorts: [{ id: 'output-document', name: 'Report', artifactKind: 'document' }] });
    const target = makeTask({ id: 'export', inputPorts: [{ id: 'scores_data', name: 'Scores', artifactKind: 'data', required: true }] });

    expect(canAppendIntentEdge(source, target, 'output-document', 'scores_data')).toBe(false);
    expect(canAppendIntentEdge(source, target, 'default', 'default')).toBe(true);
  });
});

describe('buildOverviewResultNodeIds', () => {
  it('excludes pending and running placeholders from Overview result interactions', () => {
    const template = makeExecution().taskResults[0]!;
    const ids = buildOverviewResultNodeIds([
      { ...template, taskId: 'pending', status: 'pending' },
      { ...template, taskId: 'running', status: 'running' },
      { ...template, taskId: 'completed', status: 'completed' },
      { ...template, taskId: 'failed', status: 'failed' },
    ]);

    expect([...ids]).toEqual(['completed', 'failed']);
  });
});

describe('shouldUsePlaybookMcpAssistant', () => {
  it('uses the MCP rollout as the sole assistant routing authority', () => {
    expect(shouldUsePlaybookMcpAssistant(true)).toBe(true);
    expect(shouldUsePlaybookMcpAssistant(false)).toBe(false);
  });
});

describe('loadLatestPlaybookAssistantHistory', () => {
  it('does not let a delayed initial load overwrite a newer conversation refresh', async () => {
    let resolveInitial!: (value: string) => void;
    let resolveScoped!: (value: string) => void;
    const initial = new Promise<string>((resolve) => { resolveInitial = resolve; });
    const scoped = new Promise<string>((resolve) => { resolveScoped = resolve; });
    const generation = { current: 0 };
    const apply = vi.fn();
    const setLoading = vi.fn();

    const initialLoad = loadLatestPlaybookAssistantHistory(() => initial, generation, apply, setLoading);
    const scopedLoad = loadLatestPlaybookAssistantHistory(() => scoped, generation, apply, setLoading);
    resolveScoped('new-conversation');
    await scopedLoad;
    resolveInitial('old-conversation');
    await initialLoad;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('new-conversation');
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});

describe('hydrateAssistantOperationHandoff', () => {
  it('surfaces status hydration failures without consuming the operation', async () => {
    const consume = vi.fn();
    await expect(hydrateAssistantOperationHandoff(
      'playbook-1',
      'operation-1',
      vi.fn().mockRejectedValue(new Error('Operation unavailable')),
      consume,
    )).rejects.toThrow('Operation unavailable');
    expect(consume).not.toHaveBeenCalled();
  });

  it('surfaces stream failures so the handoff URL can be retained', async () => {
    await expect(hydrateAssistantOperationHandoff(
      'playbook-1',
      'operation-1',
      vi.fn().mockResolvedValue({ operationId: 'operation-1', playbookId: 'playbook-1', baseDefinitionRevision: 4 }),
      vi.fn().mockResolvedValue({ status: 'failed', error: 'Stream failed' }),
    )).rejects.toThrow('Stream failed');
  });
});

describe('canonical assistant commit completion', () => {
  it('recognizes backend success from its revision even when newer local edits remain dirty', () => {
    expect(didCanonicalAssistantCommitSucceed('operation-1', 'operation-1', 7, 8)).toBe(true);
  });

  it('keeps the operation retryable when persistence does not advance its revision', () => {
    expect(didCanonicalAssistantCommitSucceed('operation-1', 'operation-1', 7, 7)).toBe(false);
    expect(didCanonicalAssistantCommitSucceed('operation-1', 'operation-1', 7, undefined)).toBe(false);
  });

  it('does not mistake an unrelated save revision for canonical operation success', () => {
    expect(didCanonicalAssistantCommitSucceed('operation-1', null, 7, 8)).toBe(false);
    expect(didCanonicalAssistantCommitSucceed('operation-1', 'operation-2', 7, 8)).toBe(false);
  });

  it('blocks navigation only while the current Playbook owns the pending operation', () => {
    expect(shouldBlockAssistantNavigation('playbook-1', 'playbook-1', 'canonical', 'applying')).toBe(true);
    expect(shouldBlockAssistantNavigation('playbook-1', 'playbook-1', 'canonical', 'ready')).toBe(true);
    expect(shouldBlockAssistantNavigation('playbook-1', 'playbook-2', 'canonical', 'ready')).toBe(false);
    expect(shouldBlockAssistantNavigation('playbook-1', 'playbook-1', 'canonical', 'idle')).toBe(false);
    expect(shouldBlockAssistantNavigation('playbook-1', 'playbook-1', 'advisor_preview', 'ready')).toBe(false);
  });

  it('pauses persistence for an owned advisor preview without blocking unrelated Playbooks', () => {
    expect(shouldPauseAssistantPersistence('playbook-1', 'playbook-1', 'ready')).toBe(true);
    expect(shouldPauseAssistantPersistence('playbook-1', 'playbook-2', 'ready')).toBe(false);
    expect(shouldPauseAssistantPersistence('playbook-1', 'playbook-1', 'idle')).toBe(false);
  });
});

describe('buildCanvasJudgeStateMap', () => {
  it('prefers an evaluated iteration over a stale evaluating iteration for the same task', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluating', judgeResult: null },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 91 } },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 91 },
      iteration: 0,
    });
  });

  it('prefers the latest iteration when judge states are equally complete', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluated', judgeResult: { overallScore: 94 } },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 94 },
      iteration: 1,
    });
  });

  it('keeps the richer evaluated result when a later duplicate lacks judge details', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 87 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluated', judgeResult: null },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 87 },
      iteration: 0,
    });
  });

  it('prefers a later failed state over an older evaluated score', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 87 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'failed', judgeResult: null },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'failed',
      judgeResult: null,
      iteration: 1,
    });
  });

  it('keeps the more complete evaluated result when both duplicates have scores', () => {
    const taskResults = [
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 0,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 87, reason: 'Detailed', rewriteHints: ['hint-1'] },
      },
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 1,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 88 },
      },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 87, reason: 'Detailed', rewriteHints: ['hint-1'] },
      iteration: 0,
    });
  });

  it('prefers the later evaluated result when both payloads are equally populated', () => {
    const taskResults = [
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 0,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 87, reason: 'Older', rewriteHints: ['hint-1', 'hint-2'] },
      },
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 1,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 92, reason: 'Newer', rewriteHints: [] },
      },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 92, reason: 'Newer', rewriteHints: [] },
      iteration: 1,
    });
  });
});

describe('hasPendingJudgeEvaluations', () => {
  it('returns true when any task result is still evaluating', () => {
    const execution = makeExecution({
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', judgeStatus: 'idle' },
        { ...makeExecution().taskResults[0], taskId: 'task-2', judgeStatus: 'evaluating' },
      ] as any,
    });

    expect(hasPendingJudgeEvaluations(execution)).toBe(true);
  });

  it('returns false once all judge states are terminal', () => {
    const execution = makeExecution({
      taskResults: [
        { ...makeExecution().taskResults[0], taskId: 'task-1', judgeStatus: 'evaluated', judgeResult: { overallScore: 90 } },
        { ...makeExecution().taskResults[0], taskId: 'task-2', judgeStatus: 'failed', judgeResult: null },
      ] as any,
    });

    expect(hasPendingJudgeEvaluations(execution)).toBe(false);
  });
});

describe('resolveCanvasNodeSelection', () => {
  it('preserves React Flow multi-selection even when selectedStepId points elsewhere', () => {
    const selectedNodeIds = new Set(['task-1', 'task-2']);

    expect(resolveCanvasNodeSelection(selectedNodeIds, 2, 'task-1', 'task-3')).toBe(true);
    expect(resolveCanvasNodeSelection(selectedNodeIds, 2, 'task-2', 'task-3')).toBe(true);
    expect(resolveCanvasNodeSelection(selectedNodeIds, 2, 'task-3', 'task-3')).toBe(false);
  });

  it('falls back to selectedStepId when there is not an active multi-selection', () => {
    const selectedNodeIds = new Set(['task-1']);

    expect(resolveCanvasNodeSelection(selectedNodeIds, 1, 'task-1', 'task-2')).toBe(false);
    expect(resolveCanvasNodeSelection(selectedNodeIds, 1, 'task-2', 'task-2')).toBe(true);
  });
});

describe('shouldAutoLayoutAfterConstruction', () => {
  it('returns true when deterministic builder reaches completed status', () => {
    expect(shouldAutoLayoutAfterConstruction('streaming', 'completed')).toBe(true);
  });

  it('returns false for repeated completed status updates', () => {
    expect(shouldAutoLayoutAfterConstruction('completed', 'completed')).toBe(false);
  });
});

describe('construction diagnostics lifecycle', () => {
  const diagnostics = [{ code: 'validator_rule_2' }] as any;

  it('never exposes diagnostics from another playbook', () => {
    expect(getScopedConstructionDiagnostics('playbook-1', 'playbook-2', diagnostics)).toEqual([]);
    expect(getScopedConstructionDiagnostics('playbook-1', 'playbook-1', diagnostics)).toBe(diagnostics);
  });

  it('ignores a late diagnostic event from the previous playbook', () => {
    const playbookBDiagnostics = [{ code: 'validator_rule_7' }] as any;
    const stateForPlaybookB = updateScopedConstructionDiagnostics(
      { ownerPlaybookId: 'playbook-2', diagnostics: [] },
      'playbook-2',
      playbookBDiagnostics,
    );

    expect(updateScopedConstructionDiagnostics(
      stateForPlaybookB,
      'playbook-1',
      diagnostics,
    )).toBe(stateForPlaybookB);
    expect(stateForPlaybookB.diagnostics).toBe(playbookBDiagnostics);
  });

  it('rejects advisor preview completion after navigation to another playbook', () => {
    expect(isPlaybookRouteCurrent('playbook-1', 'playbook-2')).toBe(false);
    expect(isPlaybookRouteCurrent('playbook-2', 'playbook-2')).toBe(true);
  });

  it('clears settled diagnostics after a later local edit', () => {
    expect(shouldClearConstructionDiagnostics('completed', true, 'idle')).toBe(true);
    expect(shouldClearConstructionDiagnostics('completed', false, 'idle')).toBe(false);
  });

  it('keeps diagnostics while an advisor preview awaits a decision', () => {
    expect(shouldClearConstructionDiagnostics('completed', true, 'ready')).toBe(false);
    expect(shouldClearConstructionDiagnostics('streaming', true, 'streaming')).toBe(false);
  });

  it('clears diagnostics from failed and cancelled constructions', () => {
    expect(shouldClearConstructionDiagnostics('failed', false, 'idle')).toBe(true);
    expect(shouldClearConstructionDiagnostics('cancelled', false, 'idle')).toBe(true);
  });

  it('retains failed construction diagnostics while a canonical draft awaits correction', () => {
    expect(shouldClearConstructionDiagnostics('failed', true, 'ready')).toBe(false);
  });
});

describe('shouldApplyInitialAutoLayout', () => {
  it('waits for the current route load instead of laying out a stale cached playbook', () => {
    expect(shouldApplyInitialAutoLayout('playbook-1', null, 'playbook-1', null)).toBe(false);
    expect(shouldApplyInitialAutoLayout('playbook-1', 'playbook-1', 'playbook-1', null)).toBe(true);
  });

  it('applies to direct navigation once per loaded playbook', () => {
    expect(shouldApplyInitialAutoLayout('playbook-1', 'playbook-1', 'playbook-1', null)).toBe(true);
    expect(shouldApplyInitialAutoLayout('playbook-1', 'playbook-1', 'playbook-1', 'playbook-1')).toBe(false);
  });
});

describe('buildIntentEdgeOptions', () => {
  it('preserves iterator conditional edge metadata and disables auto binding', () => {
    expect(buildIntentEdgeOptions('conditional', 'approved', 2)).toEqual({
      kind: 'conditional',
      routerLabel: 'approved',
      priority: 2,
      autoBind: false,
    });
  });

  it('treats router labels as conditional even when edge kind is omitted', () => {
    expect(buildIntentEdgeOptions(undefined, 'approved', null)).toEqual({
      kind: 'conditional',
      routerLabel: 'approved',
      priority: null,
      autoBind: false,
    });
  });

  it('auto-binds only non-conditional iterator edges', () => {
    expect(buildIntentEdgeOptions('sequential', null, null)).toEqual({
      kind: 'sequential',
      routerLabel: null,
      priority: null,
      autoBind: true,
    });
  });
});

describe('resolveIntentNodeSemantics', () => {
  it('lets primitive-derived router semantics override stale agent template metadata', () => {
    expect(resolveIntentNodeSemantics('router', 'router', 'agent', false)).toEqual({
      nodeType: 'router',
      taskType: 'router',
    });
  });

  it('treats generated tasks with router config as routers when node type is absent', () => {
    expect(resolveIntentNodeSemantics(undefined, undefined, 'agent', false, true)).toEqual({
      nodeType: 'router',
      taskType: 'router',
    });
  });

  it('treats generated tasks with human approval config as human approval when node type is absent', () => {
    expect(resolveIntentNodeSemantics(undefined, undefined, 'agent', false, false, true)).toEqual({
      nodeType: 'human_approval',
      taskType: 'generic',
    });
  });
});

describe('remapRouterConditionSourceNodes', () => {
  it('rewrites blueprint router condition source refs to generated node ids', () => {
    const task = {
      id: 'router-id',
      routerConfig: {
        outputLabels: ['documents', 'other'],
        defaultLabel: 'other',
        conditions: [
          { label: 'documents', sourceNode: 'extract_extension', sourcePort: 'extension', operator: 'equals' as const, value: '.docx' },
          { label: 'other', sourceNode: 'external-node', sourcePort: 'extension', operator: 'exists' as const },
        ],
      },
    } as any;

    const remapped = remapRouterConditionSourceNodes(task, new Map([['extract_extension', 'intent-node-extract']]));

    expect(remapped.routerConfig.conditions[0].sourceNode).toBe('intent-node-extract');
    expect(remapped.routerConfig.conditions[1].sourceNode).toBe('external-node');
  });
});

describe('resolveDiagnosticNodeId', () => {
  it('resolves a generated node ref using the construction application key', () => {
    const task = { id: 'intent-node-prepare', title: 'Prepare report' } as any;
    const diagnostic = {
      severity: 'warning',
      stage: 'repair',
      code: 'repair',
      message: 'repair',
      reviewTarget: { kind: 'node', nodeRef: 'prepare_report', nodeLabel: 'Prepare report' },
    } as any;
    const expectedId = resolveDiagnosticNodeId(diagnostic, null, [task]);

    expect(expectedId).toBe('intent-node-prepare');
  });
});
