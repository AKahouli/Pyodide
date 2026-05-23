import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildClipboardPayload,
  validateClipboardPayload,
  remapClipboardPayload,
  removeCutSourceItems,
  checkPasteCompatibility,
  type PlaybookClipboardPayload,
} from './playbookClipboard';
import type { PlaybookTask, PlaybookEdge, DataBinding, ToolBinding, InputFile } from '../types';

function makeTask(overrides: Partial<PlaybookTask> = {}): PlaybookTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    assignedAgentId: null,
    executionOrder: 0,
    positionX: 100,
    positionY: 200,
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    clarificationPrompt: '',
    maxClarifications: 3,
    inputKeys: [],
    outputKey: '',
    enabled: true,
    notifyOnComplete: false,
    notifyEmails: [],
    inputFiles: [],
    ...overrides,
  };
}

function makeEdge(sourceId: string, targetId: string): PlaybookEdge {
  return {
    id: `e-${sourceId}-default-${targetId}-default`,
    sourceId,
    targetId,
    sourceOutputPortId: 'default',
    targetInputPortId: 'default',
  };
}

function makeDataBinding(
  sourceKind: DataBinding['sourceKind'],
  targetNode: string,
  sourceNode?: string,
): DataBinding {
  return {
    id: `db-${sourceNode ?? sourceKind}-${targetNode}`,
    targetNode,
    targetPort: 'default',
    sourceKind,
    sourceNode,
    sourcePort: 'default',
  };
}

describe('buildClipboardPayload', () => {
  it('copies a single task with no edges', () => {
    const task = makeTask();
    const payload = buildClipboardPayload({
      tasks: [task],
      allEdges: [],
      allDataBindings: [],
      selectedTaskIds: new Set(['task-1']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].id).toBe('task-1');
    expect(payload.edges).toHaveLength(0);
    expect(payload.dataBindings).toHaveLength(0);
    expect(payload.operation).toBe('copy');
    expect(payload.sourceTaskIds).toEqual(['task-1']);
  });

  it('preserves internal edges and drops external edges', () => {
    const taskA = makeTask({ id: 'a', positionX: 0, positionY: 0 });
    const taskB = makeTask({ id: 'b', positionX: 200, positionY: 0 });
    const taskC = makeTask({ id: 'c', positionX: 400, positionY: 0 });

    const edgeAB = makeEdge('a', 'b');
    const edgeBC = makeEdge('b', 'c');
    const edgeAC = makeEdge('a', 'c');

    const payload = buildClipboardPayload({
      tasks: [taskA, taskB, taskC],
      allEdges: [edgeAB, edgeBC, edgeAC],
      allDataBindings: [],
      selectedTaskIds: new Set(['a', 'b']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0].sourceId).toBe('a');
    expect(payload.edges[0].targetId).toBe('b');
  });

  it('keeps node-output data bindings only when both ends are selected', () => {
    const taskA = makeTask({ id: 'a' });
    const taskB = makeTask({ id: 'b' });
    const taskC = makeTask({ id: 'c' });

    const bindingAB = makeDataBinding('node-output', 'b', 'a');
    const bindingAC = makeDataBinding('node-output', 'c', 'a');

    const payload = buildClipboardPayload({
      tasks: [taskA, taskB, taskC],
      allEdges: [],
      allDataBindings: [bindingAB, bindingAC],
      selectedTaskIds: new Set(['a', 'b']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.dataBindings).toHaveLength(1);
    expect(payload.dataBindings[0].targetNode).toBe('b');
    expect(payload.dataBindings[0].sourceNode).toBe('a');
  });

  it('keeps constant/state/expression bindings for selected targets', () => {
    const taskA = makeTask({ id: 'a' });
    const taskB = makeTask({ id: 'b' });

    const constBinding = makeDataBinding('constant', 'a');
    const stateBinding = makeDataBinding('state', 'a');
    const exprBinding = makeDataBinding('expression', 'b');

    const payload = buildClipboardPayload({
      tasks: [taskA, taskB],
      allEdges: [],
      allDataBindings: [constBinding, stateBinding, exprBinding],
      selectedTaskIds: new Set(['a']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.dataBindings).toHaveLength(2);
    expect(payload.dataBindings.every((db) => db.targetNode === 'a')).toBe(true);
  });

  it('drops trigger bindings', () => {
    const taskA = makeTask({ id: 'a' });
    const triggerBinding: DataBinding = {
      id: 'db-trigger-a',
      targetNode: 'a',
      targetPort: 'default',
      sourceKind: 'trigger',
      triggerPath: 'payload',
    };

    const payload = buildClipboardPayload({
      tasks: [taskA],
      allEdges: [],
      allDataBindings: [triggerBinding],
      selectedTaskIds: new Set(['a']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.dataBindings).toHaveLength(0);
  });

  it('strips runtime replay fields from tasks', () => {
    const task = makeTask({
      hasValidatedReplay: true,
      activeReplayId: 'replay-1',
      activeReplayVersion: 2,
      stepReplayMode: 'replay_strict',
    });

    const payload = buildClipboardPayload({
      tasks: [task],
      allEdges: [],
      allDataBindings: [],
      selectedTaskIds: new Set(['task-1']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.tasks[0]).not.toHaveProperty('hasValidatedReplay');
    expect(payload.tasks[0]).not.toHaveProperty('activeReplayId');
    expect(payload.tasks[0]).not.toHaveProperty('stepReplayMode');
    expect(payload.tasks[0].id).toBe('task-1');
  });

  it('computes bounds from selected task positions', () => {
    const taskA = makeTask({ id: 'a', positionX: 50, positionY: 100 });
    const taskB = makeTask({ id: 'b', positionX: 250, positionY: 300 });

    const payload = buildClipboardPayload({
      tasks: [taskA, taskB],
      allEdges: [],
      allDataBindings: [],
      selectedTaskIds: new Set(['a', 'b']),
      sourcePlaybookId: 'pb-1',
      operation: 'copy',
    });

    expect(payload.bounds).toEqual({
      minX: 50,
      minY: 100,
      maxX: 250,
      maxY: 300,
    });
  });
});

describe('validateClipboardPayload', () => {
  it('accepts valid payload', () => {
    const payload: PlaybookClipboardPayload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'Task', positionX: 0, positionY: 0 } as PlaybookTask],
      edges: [],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: [],
    };

    const result = validateClipboardPayload(payload);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('yellowstorm/playbook-nodes');
    expect(result!.tasks).toHaveLength(1);
  });

  it('rejects invalid type', () => {
    expect(
      validateClipboardPayload({ type: 'something-else', version: 1, tasks: [], edges: [], dataBindings: [] }),
    ).toBeNull();
  });

  it('rejects wrong version', () => {
    expect(
      validateClipboardPayload({
        type: 'yellowstorm/playbook-nodes',
        version: 99,
        tasks: [],
        edges: [],
        dataBindings: [],
      }),
    ).toBeNull();
  });

  it('rejects missing tasks array', () => {
    expect(
      validateClipboardPayload({
        type: 'yellowstorm/playbook-nodes',
        version: 1,
        edges: [],
        dataBindings: [],
      }),
    ).toBeNull();
  });

  it('rejects null', () => {
    expect(validateClipboardPayload(null)).toBeNull();
  });

  it('rejects invalid JSON string', () => {
    expect(validateClipboardPayload('not-json')).toBeNull();
  });

  it('rejects payload with edge referencing unknown task', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [{ id: 'e1', sourceId: 'a', targetId: 'nonexistent' }],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: ['a'],
    };

    expect(validateClipboardPayload(payload)).toBeNull();
  });

  it('rejects payload with missing required fields', () => {
    expect(
      validateClipboardPayload({
        type: 'yellowstorm/playbook-nodes',
        version: 1,
        tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
        edges: [],
        dataBindings: [],
      }),
    ).toBeNull();
  });

  it('rejects payload with trigger binding', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [],
      dataBindings: [{ targetNode: 'a', targetPort: 'default', sourceKind: 'trigger' }],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: ['a'],
    };

    expect(validateClipboardPayload(payload)).toBeNull();
  });

  it('rejects payload with binding targeting unknown task', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [],
      dataBindings: [{ targetNode: 'nonexistent', targetPort: 'default', sourceKind: 'constant' }],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: ['a'],
    };

    expect(validateClipboardPayload(payload)).toBeNull();
  });

  it('rejects payload with sourceTaskId not in tasks', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'cut',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: ['a', 'nonexistent'],
    };

    expect(validateClipboardPayload(payload)).toBeNull();
  });

  it('rejects payload with non-string sourceTaskId', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'cut',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: [123],
    };

    expect(validateClipboardPayload(payload)).toBeNull();
  });

  it('accepts cut payload with sourceTaskIds matching tasks', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'cut',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [
        { id: 'a', title: 'A', positionX: 0, positionY: 0 },
        { id: 'b', title: 'B', positionX: 100, positionY: 0 },
      ],
      edges: [],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      sourceTaskIds: ['a', 'b'],
    };

    const result = validateClipboardPayload(payload);
    expect(result).not.toBeNull();
    expect(result!.sourceTaskIds).toEqual(['a', 'b']);
  });
});

describe('remapClipboardPayload', () => {
  function makePayload(
    tasks: PlaybookTask[],
    edges: PlaybookEdge[] = [],
    bindings: DataBinding[] = [],
  ): PlaybookClipboardPayload {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tasks) {
      minX = Math.min(minX, t.positionX);
      minY = Math.min(minY, t.positionY);
      maxX = Math.max(maxX, t.positionX);
      maxY = Math.max(maxY, t.positionY);
    }
    return {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks,
      edges,
      dataBindings: bindings,
      bounds: { minX, minY, maxX, maxY },
      sourceTaskIds: tasks.map((t) => t.id),
    };
  }

  it('generates new IDs for all tasks', () => {
    const task = makeTask({ id: 'original-id' });
    const payload = makePayload([task]);
    const result = remapClipboardPayload(payload);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).not.toBe('original-id');
    expect(result.pastedTaskIds).toHaveLength(1);
    expect(result.pastedTaskIds[0]).not.toBe('original-id');
  });

  it('remaps edge sourceId and targetId', () => {
    const taskA = makeTask({ id: 'a', positionX: 0, positionY: 0 });
    const taskB = makeTask({ id: 'b', positionX: 200, positionY: 0 });
    const edge = makeEdge('a', 'b');

    const payload = makePayload([taskA, taskB], [edge]);
    const result = remapClipboardPayload(payload);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceId).not.toBe('a');
    expect(result.edges[0].targetId).not.toBe('b');
  });

  it('remaps data binding targetNode and sourceNode', () => {
    const taskA = makeTask({ id: 'a', positionX: 0, positionY: 0 });
    const taskB = makeTask({ id: 'b', positionX: 200, positionY: 0 });
    const binding = makeDataBinding('node-output', 'b', 'a');

    const payload = makePayload([taskA, taskB], [], [binding]);
    const result = remapClipboardPayload(payload);

    expect(result.dataBindings).toHaveLength(1);
    expect(result.dataBindings[0].targetNode).not.toBe('b');
    expect(result.dataBindings[0].sourceNode).not.toBe('a');
  });

  it('remaps iterator parent references when parent is copied', () => {
    const parentTask = makeTask({ id: 'parent', positionX: 0, positionY: 0 });
    const childTask = makeTask({
      id: 'child',
      positionX: 50,
      positionY: 50,
      containerConfig: { parentIteratorId: 'parent' },
    });

    const payload = makePayload([parentTask, childTask]);
    const result = remapClipboardPayload(payload);

    const child = result.tasks.find((t) =>
      t.containerConfig?.parentIteratorId,
    );
    const parent = result.tasks.find((t) =>
      t.id === child?.containerConfig?.parentIteratorId,
    );

    expect(child).toBeDefined();
    expect(parent).toBeDefined();
    expect(parent!.id).not.toBe('parent');
    expect(child!.id).not.toBe('child');
    expect(child!.containerConfig!.parentIteratorId).toBe(parent!.id);
  });

  it('clears iterator parent when parent is not copied', () => {
    const childTask = makeTask({
      id: 'child',
      positionX: 50,
      positionY: 50,
      containerConfig: { parentIteratorId: 'parent-not-copied' },
    });

    const payload = makePayload([childTask]);
    const result = remapClipboardPayload(payload);

    expect(result.tasks[0].containerConfig).toEqual({ parentIteratorId: null });
  });

  it('offsets positions relative to bounds', () => {
    const task = makeTask({ id: 'a', positionX: 100, positionY: 200 });
    const payload = makePayload([task]);

    const result = remapClipboardPayload(payload);
    const pastedTask = result.tasks[0];

    expect(pastedTask.positionX).toBeCloseTo(100 + 48);
    expect(pastedTask.positionY).toBeCloseTo(200 + 48);
  });

  it('uses viewport center when provided', () => {
    const task = makeTask({ id: 'a', positionX: 100, positionY: 200 });
    const payload = makePayload([task]);

    const result = remapClipboardPayload(payload, {
      viewportCenter: { x: 500, y: 400 },
    });
    const pastedTask = result.tasks[0];

    expect(pastedTask.positionX).toBeCloseTo(500);
    expect(pastedTask.positionY).toBeCloseTo(400);
  });

  it('increases offset with pasteCount', () => {
    const task = makeTask({ id: 'a', positionX: 100, positionY: 200 });
    const payload = makePayload([task]);

    const result1 = remapClipboardPayload(payload, { pasteCount: 0 });
    const result2 = remapClipboardPayload(payload, { pasteCount: 1 });

    expect(result2.tasks[0].positionX).toBeGreaterThan(result1.tasks[0].positionX);
    expect(result2.tasks[0].positionY).toBeGreaterThan(result1.tasks[0].positionY);
  });
});

describe('removeCutSourceItems', () => {
  it('removes cut tasks from source', () => {
    const taskA = makeTask({ id: 'a' });
    const taskB = makeTask({ id: 'b' });
    const taskC = makeTask({ id: 'c' });

    const result = removeCutSourceItems(
      { tasks: [taskA, taskB, taskC], edges: [], dataBindings: [] },
      ['a', 'c'],
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('b');
  });

  it('removes edges connected to cut tasks', () => {
    const edgeAB = makeEdge('a', 'b');
    const edgeBD = makeEdge('b', 'd');
    const edgeCD = makeEdge('c', 'd');

    const result = removeCutSourceItems(
      { tasks: [], edges: [edgeAB, edgeBD, edgeCD], dataBindings: [] },
      ['a', 'c'],
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceId).toBe('b');
    expect(result.edges[0].targetId).toBe('d');
  });

  it('removes data bindings targeting or sourced from cut tasks', () => {
    const bindingA = makeDataBinding('constant', 'a');
    const bindingB = makeDataBinding('constant', 'b');
    const bindingNodeOutput = makeDataBinding('node-output', 'b', 'a');

    const result = removeCutSourceItems(
      { tasks: [], edges: [], dataBindings: [bindingA, bindingB, bindingNodeOutput] },
      ['a'],
    );

    expect(result.dataBindings).toHaveLength(1);
    expect(result.dataBindings[0].targetNode).toBe('b');
  });

  it('returns empty arrays when all items are cut', () => {
    const task = makeTask({ id: 'only' });
    const result = removeCutSourceItems(
      { tasks: [task], edges: [], dataBindings: [] },
      ['only'],
    );

    expect(result.tasks).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.dataBindings).toHaveLength(0);
  });

  it('does not touch items when sourceTaskIds is empty', () => {
    const taskA = makeTask({ id: 'a' });
    const edgeAB = makeEdge('a', 'b');

    const result = removeCutSourceItems(
      { tasks: [taskA], edges: [edgeAB], dataBindings: [] },
      [],
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });
});

describe('cut payload behavior', () => {
  it('buildClipboardPayload produces operation=cut for cut', () => {
    const task = makeTask();
    const payload = buildClipboardPayload({
      tasks: [task],
      allEdges: [],
      allDataBindings: [],
      selectedTaskIds: new Set(['task-1']),
      sourcePlaybookId: 'pb-1',
      operation: 'cut',
    });

    expect(payload.operation).toBe('cut');
    expect(payload.sourceTaskIds).toEqual(['task-1']);
    expect(payload.sourcePlaybookId).toBe('pb-1');
  });

  it('validateClipboardPayload accepts cut operation', () => {
    const payload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'cut',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [{ id: 'a', title: 'A', positionX: 0, positionY: 0 }],
      edges: [],
      dataBindings: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceTaskIds: ['a'],
    };

    expect(validateClipboardPayload(payload)).not.toBeNull();
  });

  it('remapClipboardPayload works identically for copy and cut payloads', () => {
    const task = makeTask({ id: 'a', positionX: 100, positionY: 200 });

    const copyPayload: PlaybookClipboardPayload = {
      type: 'yellowstorm/playbook-nodes',
      version: 1,
      operation: 'copy',
      sourcePlaybookId: 'pb-1',
      copiedAt: new Date().toISOString(),
      tasks: [task],
      edges: [],
      dataBindings: [],
      bounds: { minX: 100, minY: 200, maxX: 100, maxY: 200 },
      sourceTaskIds: ['a'],
    };

    const cutPayload: PlaybookClipboardPayload = { ...copyPayload, operation: 'cut' };

    const copyResult = remapClipboardPayload(copyPayload);
    const cutResult = remapClipboardPayload(cutPayload);

    expect(copyResult.tasks).toHaveLength(cutResult.tasks.length);
    expect(copyResult.edges).toHaveLength(cutResult.edges.length);
    expect(copyResult.dataBindings).toHaveLength(cutResult.dataBindings.length);
  });
});

describe('checkPasteCompatibility', () => {
  it('returns empty warnings when all references are available', () => {
    const task = makeTask({
      assignedAgentId: 'agent-1',
      toolBindings: [{ id: 'tb-1', connectorId: 'conn-1', actions: [] }],
      inputFiles: [{ type: 'workspace', id: 'doc-1', name: 'Doc', workspaceId: 'ws-1' }],
    });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(['agent-1']),
      workspaceIds: new Set(['ws-1']),
      connectorIds: new Set(['conn-1']),
    });

    expect(warnings).toHaveLength(0);
  });

  it('warns when assigned agent is not in context', () => {
    const task = makeTask({ id: 't1', title: 'My Task', assignedAgentId: 'agent-missing' });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(['agent-1']),
      workspaceIds: new Set(),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('agent');
    expect(warnings[0].referenceId).toBe('agent-missing');
    expect(warnings[0].taskTitle).toBe('My Task');
  });

  it('warns when connector is not in context', () => {
    const task = makeTask({
      toolBindings: [
        { id: 'tb-1', connectorId: 'conn-missing', actions: [] },
      ] as ToolBinding[],
    });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: new Set(['conn-1']),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('connector');
    expect(warnings[0].referenceId).toBe('conn-missing');
  });

  it('warns when input file workspace is not in context', () => {
    const task = makeTask({
      inputFiles: [
        { type: 'workspace', id: 'doc-1', name: 'Doc', workspaceId: 'ws-missing' },
      ] as InputFile[],
    });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(),
      workspaceIds: new Set(['ws-1']),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('workspace');
    expect(warnings[0].referenceId).toBe('ws-missing');
  });

  it('skips tasks with null assignedAgentId', () => {
    const task = makeTask({ assignedAgentId: null });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(0);
  });

  it('skips input files without workspaceId', () => {
    const task = makeTask({
      inputFiles: [{ type: 'document', id: 'doc-1', name: 'Doc' }] as InputFile[],
    });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(0);
  });

  it('collects multiple warnings across tasks', () => {
    const task1 = makeTask({ id: 't1', assignedAgentId: 'agent-x' });
    const task2 = makeTask({
      id: 't2',
      toolBindings: [{ id: 'tb-1', connectorId: 'conn-x', actions: [] }] as ToolBinding[],
    });
    const task3 = makeTask({
      id: 't3',
      inputFiles: [{ type: 'workspace', id: 'd', name: 'D', workspaceId: 'ws-x' }] as InputFile[],
    });

    const warnings = checkPasteCompatibility([task1, task2, task3], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(3);
    expect(warnings.filter((w) => w.kind === 'agent')).toHaveLength(1);
    expect(warnings.filter((w) => w.kind === 'connector')).toHaveLength(1);
    expect(warnings.filter((w) => w.kind === 'workspace')).toHaveLength(1);
  });

  it('returns empty for empty task list', () => {
    const warnings = checkPasteCompatibility([], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: new Set(),
    });

    expect(warnings).toHaveLength(0);
  });

  it('skips agent check when agentIds is null', () => {
    const task = makeTask({ assignedAgentId: 'agent-missing' });

    const warnings = checkPasteCompatibility([task], {
      agentIds: null,
      workspaceIds: new Set(),
      connectorIds: null,
    });

    expect(warnings).toHaveLength(0);
  });

  it('skips connector check when connectorIds is null', () => {
    const task = makeTask({
      toolBindings: [{ id: 'tb-1', connectorId: 'conn-missing', actions: [] }] as ToolBinding[],
    });

    const warnings = checkPasteCompatibility([task], {
      agentIds: new Set(),
      workspaceIds: new Set(),
      connectorIds: null,
    });

    expect(warnings).toHaveLength(0);
  });
});
