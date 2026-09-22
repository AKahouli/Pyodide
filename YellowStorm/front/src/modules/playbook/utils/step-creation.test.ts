import { describe, it, expect } from 'vitest';
import {
  buildTaskFromBlueprint,
  planConnectionForNewTask,
  planInsertOnEdge,
  blueprintCanInsertOnEdge,
  type StepBlueprint,
} from './step-creation';
import type { DataBinding, PlaybookEdge, PlaybookTask, TaskTemplate } from '../types';

const TITLES = { blankStep: 'Step', router: 'Router', humanApproval: 'Approval' };

function makeTask(overrides: Partial<PlaybookTask> = {}): PlaybookTask {
  return {
    id: 'task-a',
    title: 'Task A',
    executionOrder: 0,
    positionX: 0,
    positionY: 0,
    inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
    outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
    ...overrides,
  } as PlaybookTask;
}

function makeTemplate(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: 'tpl-1',
    key: 'tpl-key',
    nodeType: 'agent',
    title: 'Summarize',
    description: 'Summarizes things',
    icon: 'FileText',
    color: '#3b82f6',
    category: 'content',
    inputPorts: [{ id: 'in', name: 'Doc', artifactKind: 'document', required: true }],
    outputPorts: [{ id: 'out', name: 'Summary', artifactKind: 'text' }],
    promptTemplate: '',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    ...overrides,
  };
}

describe('buildTaskFromBlueprint', () => {
  it('builds a blank step with default text ports', () => {
    const task = buildTaskFromBlueprint({ kind: 'blank' }, {
      position: { x: 10, y: 20 },
      executionOrder: 3,
      titles: TITLES,
    });
    expect(task.title).toBe('Step 4');
    expect(task.positionX).toBe(10);
    expect(task.inputPorts).toHaveLength(1);
    expect(task.inputPorts![0].artifactKind).toBe('text');
    expect(task.nodeType).toBeUndefined();
  });

  it('builds a router with branch output ports', () => {
    const task = buildTaskFromBlueprint({ kind: 'router' }, {
      position: { x: 0, y: 0 },
      executionOrder: 0,
      titles: TITLES,
    });
    expect(task.nodeType).toBe('router');
    expect(task.outputPorts!.map((p) => p.id)).toEqual(['retry', 'done', '__error__']);
    expect(task.routerConfig?.maxIterations).toBe(3);
  });

  it('builds a human approval node', () => {
    const task = buildTaskFromBlueprint({ kind: 'humanApproval' }, {
      position: { x: 0, y: 0 },
      executionOrder: 0,
      titles: TITLES,
    });
    expect(task.nodeType).toBe('human_approval');
    expect(task.humanApprovalConfig).toEqual({ promptTemplate: '', timeoutSeconds: 3600 });
  });

  it('builds from a catalog template preserving ports and node template key', () => {
    const task = buildTaskFromBlueprint({ kind: 'template', template: makeTemplate() }, {
      position: { x: 5, y: 5 },
      executionOrder: 1,
      titles: TITLES,
    });
    expect(task.title).toBe('Summarize 2');
    expect(task.nodeTemplateKey).toBe('tpl-key');
    expect(task.inputPorts![0].artifactKind).toBe('document');
    expect(task.outputPorts![0].artifactKind).toBe('text');
  });

  it('generates unique ids per call', () => {
    const a = buildTaskFromBlueprint({ kind: 'blank' }, { position: { x: 0, y: 0 }, executionOrder: 0, titles: TITLES });
    const b = buildTaskFromBlueprint({ kind: 'blank' }, { position: { x: 0, y: 0 }, executionOrder: 0, titles: TITLES });
    expect(a.id).not.toBe(b.id);
  });
});

describe('planConnectionForNewTask', () => {
  it('connects using a matching existing input port', () => {
    const source = makeTask({ id: 'a', outputPorts: [{ id: 'o1', name: 'Out', artifactKind: 'document' }] });
    const newTask = makeTask({
      inputPorts: [
        { id: 'text-in', name: 'Text', artifactKind: 'text', required: false },
        { id: 'doc-in', name: 'Doc', artifactKind: 'document', required: false },
      ],
    });
    const plan = planConnectionForNewTask(
      { nodeId: 'a', task: source, outputPorts: source.outputPorts! },
      newTask,
    );
    expect(plan.edge?.targetInputPortId).toBe('doc-in');
    expect(plan.binding?.sourceKind).toBe('node-output');
    expect(plan.binding?.targetPort).toBe('doc-in');
    expect(plan.taskInputPorts).toHaveLength(2);
  });

  it('appends a compatible input port when none matches', () => {
    const source = makeTask({ id: 'a', outputPorts: [{ id: 'o1', name: 'Out', artifactKind: 'data' }] });
    const newTask = makeTask();
    const plan = planConnectionForNewTask(
      { nodeId: 'a', task: source, outputPorts: source.outputPorts! },
      newTask,
    );
    expect(plan.taskInputPorts).toHaveLength(2);
    expect(plan.taskInputPorts[1].artifactKind).toBe('data');
    expect(plan.edge?.targetInputPortId).toBe(plan.taskInputPorts[1].id);
  });

  it('honours an explicit source handle (router branch stays binding-free)', () => {
    const router = makeTask({
      id: 'r',
      nodeType: 'router',
      outputPorts: [
        { id: 'done', name: 'done', artifactKind: 'text' },
        { id: '__error__', name: '__error__', artifactKind: 'text' },
      ],
    });
    const plan = planConnectionForNewTask(
      { nodeId: 'r', task: router, outputPorts: router.outputPorts!, sourcePortId: '__error__' },
      makeTask({ id: 'n' }),
    );
    expect(plan.sourcePortId).toBe('__error__');
    expect(plan.edge?.sourceOutputPortId).toBe('__error__');
    expect(plan.binding).toBeNull();
  });

  it('creates a trigger binding without a control edge for the mail trigger', () => {
    const plan = planConnectionForNewTask(
      { nodeId: '__trigger__', task: null, outputPorts: [{ id: 'mail_data', name: 'Mail data', artifactKind: 'data' }] },
      makeTask({ id: 'n' }),
    );
    expect(plan.edge).toBeNull();
    expect(plan.binding?.sourceKind).toBe('trigger');
    expect(plan.binding?.triggerPath).toBe('mail_data');
  });
});

describe('planInsertOnEdge', () => {
  const edge: PlaybookEdge = {
    id: 'e-a-default-b-default',
    sourceId: 'a',
    sourceOutputPortId: 'default',
    targetId: 'b',
    targetInputPortId: 'default',
  };
  const binding: DataBinding = {
    id: 'db-a-default-b-default',
    targetNode: 'b',
    targetPort: 'default',
    sourceKind: 'node-output',
    sourceNode: 'a',
    sourcePort: 'default',
    iteration: 'current',
  };

  it('rewires A→B into A→New→B and splits the data binding', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    const newTask = makeTask({ id: 'm', nodeTemplateKey: undefined });
    const plan = planInsertOnEdge(edge, tasks, [binding], newTask)!;
    expect(plan).not.toBeNull();
    expect(plan.removedEdgeId).toBe(edge.id);
    expect(plan.addedEdges).toHaveLength(2);
    expect(plan.addedEdges[0]).toMatchObject({ sourceId: 'a', targetId: 'm' });
    expect(plan.addedEdges[1]).toMatchObject({ sourceId: 'm', targetId: 'b' });
    expect(plan.removedBindingIds).toEqual([binding.id]);
    expect(plan.addedBindings).toHaveLength(2);
    expect(plan.addedBindings[0]).toMatchObject({ sourceNode: 'a', targetNode: 'm' });
    expect(plan.addedBindings[1]).toMatchObject({ sourceNode: 'm', targetNode: 'b' });
  });

  it('preserves a router branch label on the segment leaving the router', () => {
    const router = makeTask({
      id: 'r',
      nodeType: 'router',
      outputPorts: [{ id: 'done', name: 'done', artifactKind: 'text' }],
    });
    const branchEdge: PlaybookEdge = {
      id: 'e-r-done-b-default',
      sourceId: 'r',
      sourceOutputPortId: 'done',
      targetId: 'b',
      targetInputPortId: 'default',
    };
    const plan = planInsertOnEdge(branchEdge, [router, makeTask({ id: 'b' })], [], makeTask({ id: 'm' }))!;
    expect(plan.addedEdges[0].sourceOutputPortId).toBe('done');
    expect(plan.addedEdges[1].sourceId).toBe('m');
    // No binding existed on the branch, so none is invented.
    expect(plan.addedBindings).toEqual([]);
    expect(plan.removedBindingIds).toEqual([]);
  });

  it('grows compatible ports on a generic blank step for typed edges', () => {
    const tasks = [
      makeTask({ id: 'a', outputPorts: [{ id: 'data-out', name: 'Data', artifactKind: 'data' }] }),
      makeTask({ id: 'b', inputPorts: [{ id: 'data-in', name: 'Data', artifactKind: 'data', required: false }] }),
    ];
    const typedEdge: PlaybookEdge = {
      id: 'e-a-data-out-b-data-in',
      sourceId: 'a',
      sourceOutputPortId: 'data-out',
      targetId: 'b',
      targetInputPortId: 'data-in',
    };
    const newTask = buildTaskFromBlueprint({ kind: 'blank' }, { position: { x: 0, y: 0 }, executionOrder: 0, titles: TITLES });
    const plan = planInsertOnEdge(typedEdge, tasks, [], newTask)!;
    expect(plan.taskInputPorts.some((p) => p.artifactKind === 'data')).toBe(true);
    expect(plan.taskOutputPorts.some((p) => p.artifactKind === 'data')).toBe(true);
  });

  it('rejects a catalog template that cannot bridge without conversion', () => {
    const tasks = [
      makeTask({ id: 'a', outputPorts: [{ id: 'data-out', name: 'Data', artifactKind: 'data' }] }),
      makeTask({ id: 'b', inputPorts: [{ id: 'data-in', name: 'Data', artifactKind: 'data', required: false }] }),
    ];
    const typedEdge: PlaybookEdge = {
      id: 'e-a-data-out-b-data-in',
      sourceId: 'a',
      sourceOutputPortId: 'data-out',
      targetId: 'b',
      targetInputPortId: 'data-in',
    };
    const templateTask = buildTaskFromBlueprint(
      { kind: 'template', template: makeTemplate() },
      { position: { x: 0, y: 0 }, executionOrder: 0, titles: TITLES },
    );
    // Template takes document in, produces text out; the edge carries data → data.
    expect(planInsertOnEdge(typedEdge, tasks, [], templateTask)).toBeNull();
  });

  it('returns null when an endpoint task is missing', () => {
    expect(planInsertOnEdge(edge, [makeTask({ id: 'a' })], [], makeTask({ id: 'm' }))).toBeNull();
  });
});

describe('blueprintCanInsertOnEdge', () => {
  const documentTemplate = makeTemplate();

  it('accepts a template matching both endpoint kinds', () => {
    const bp: StepBlueprint = { kind: 'template', template: documentTemplate };
    expect(blueprintCanInsertOnEdge(bp, 'document', 'text')).toBe(true);
  });

  it('rejects a template mismatching the source kind', () => {
    const bp: StepBlueprint = { kind: 'template', template: documentTemplate };
    expect(blueprintCanInsertOnEdge(bp, 'data', 'text')).toBe(false);
  });

  it('rejects a template mismatching the target kind', () => {
    const bp: StepBlueprint = { kind: 'template', template: documentTemplate };
    expect(blueprintCanInsertOnEdge(bp, 'document', 'data')).toBe(false);
  });

  it('always accepts the generic blank step', () => {
    expect(blueprintCanInsertOnEdge({ kind: 'blank' }, 'data', 'image')).toBe(true);
  });

  it('text-only presets fit text edges', () => {
    expect(blueprintCanInsertOnEdge({ kind: 'router' }, 'text', 'text')).toBe(true);
    expect(blueprintCanInsertOnEdge({ kind: 'humanApproval' }, 'text', 'text')).toBe(true);
    expect(blueprintCanInsertOnEdge({ kind: 'humanApproval' }, 'document', 'text')).toBe(false);
  });
});
