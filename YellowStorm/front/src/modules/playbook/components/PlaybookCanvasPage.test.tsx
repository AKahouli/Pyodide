import { describe, expect, it, vi } from 'vitest';
import { buildIntentEdgeOptions, buildOverviewResultNodeIds, getScopedConstructionDiagnostics, hydrateAssistantOperationHandoff, isPlaybookRouteCurrent, isTaskConfiguredForExecution, loadLatestPlaybookAssistantHistory, remapRouterConditionSourceNodes, resolveDiagnosticNodeId, resolveIntentNodeSemantics, shouldApplyInitialAutoLayout, shouldAutoLayoutAfterConstruction, shouldBlockCanvasMutationShortcut, shouldClearConstructionDiagnostics, shouldEnableCanvasNodeDragging, shouldRenderPlaybookAssistant, shouldUsePlaybookMcpAssistant, updateScopedConstructionDiagnostics } from './PlaybookCanvasPage';
import { resolveCanvasNodeSelection } from '../utils/playbook-canvas-selection';
import { buildCanvasJudgeStateMap, hasPendingJudgeEvaluations } from '../utils/playbook-canvas-status';
import { makeExecution } from '../test-utils';
import type { PlaybookTask } from '../types';

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

describe('isTaskConfiguredForExecution', () => {
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
