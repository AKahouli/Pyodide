import {
  castControlEdges,
  castDataBindings,
  castFlowNodes,
  castFlowSettings,
  castHitlBlockers,
  castHitlPolicy,
  castMixedObject,
  castTriggerConfig,
} from './flow-cast';

/** Expected values are what the Mongoose Flow schema's toJSON() returned for the same input. */
describe('flow-cast', () => {
  it('casts nodes: unknown keys dropped, subdocument defaults filled, empty objects removed, null kept', () => {
    const input = [
      {
        id: 'n1',
        kind: 'step',
        label: null,
        extra: 1,
        input: { raw: 'r' },
        output: {},
        metadata: {},
        routerConfig: { maxIterations: 1 },
        retryPolicy: { maxRetries: 3, delayMs: null },
        hitlPolicy: { mode: 'manual', extra: 1, inheritedFromWorkflow: true },
      },
      { id: 'n2', kind: 'step', metadata: { a: {}, b: [{}], c: { d: {} } }, iteratorConfig: { collectionPath: 'x' }, humanApprovalConfig: {}, dynamicReasoning: {} },
    ];
    const snapshot = JSON.stringify(input);
    expect(castFlowNodes(input)).toEqual([
      {
        id: 'n1',
        kind: 'step',
        label: null,
        input: { raw: 'r', ports: [] },
        output: { ports: [] },
        routerConfig: { outputLabels: [], maxIterations: 1, conditions: [] },
        retryPolicy: { maxRetries: 3, delayMs: null },
        hitlPolicy: {
          mode: 'manual',
          sensitivity: 'balanced',
          clarificationEnabled: true,
          approvalEnabled: true,
          reviewEnabled: false,
          propagateFeedbackDefault: true,
          defaultFeedbackScope: 'downstream_run',
          inheritedFromWorkflow: true,
          disabledReason: null,
        },
      },
      { id: 'n2', kind: 'step', iteratorConfig: { collectionPath: 'x' }, metadata: { b: [{}] }, dynamicReasoning: { enabled: false } },
    ]);
    // The caller's objects are never mutated.
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('casts edges and bindings with their defaults', () => {
    expect(castControlEdges([{ id: 'e', kind: 'sequential', source: 'a', target: 'b', x: 1 }])).toEqual([{ id: 'e', kind: 'sequential', source: 'a', target: 'b', priority: 0 }]);
    expect(castDataBindings([
      { id: 'd1', targetNode: 'n', targetPort: 'p', sourceKind: 'constant', constantValue: {} },
      { id: 'd2', targetNode: 'n', targetPort: 'p', sourceKind: 'constant', constantValue: { x: 1 }, iteration: null },
    ])).toEqual([
      { id: 'd1', targetNode: 'n', targetPort: 'p', sourceKind: 'constant', iteration: 'current' },
      { id: 'd2', targetNode: 'n', targetPort: 'p', sourceKind: 'constant', constantValue: { x: 1 }, iteration: null },
    ]);
    expect(castFlowNodes(undefined)).toEqual([]);
  });

  it('casts HITL blockers with their defaults and dates as ISO strings', () => {
    const [blocker] = castHitlBlockers<Record<string, unknown>>([
      { id: 'b', kind: 'custom', label: 'l', description: 'd', action: 'clarify', matcherType: 'llm_judge', foo: 2, createdAt: '2020-01-01T00:00:00Z' },
    ]);
    expect(blocker).toEqual({
      id: 'b',
      scope: 'workflow',
      nodeId: null,
      enabled: true,
      kind: 'custom',
      label: 'l',
      description: 'd',
      action: 'clarify',
      riskLevel: 'medium',
      sensitivity: 'balanced',
      matcherType: 'llm_judge',
      promptTemplate: null,
      appliesToToolNames: [],
      appliesToConnectorActions: [],
      createdBy: 'system',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('casts the top-level objects', () => {
    expect(castHitlPolicy(undefined)).toEqual({
      mode: 'auto',
      sensitivity: 'balanced',
      clarificationEnabled: true,
      approvalEnabled: true,
      reviewEnabled: false,
      propagateFeedbackDefault: true,
      defaultFeedbackScope: 'downstream_run',
      disabledReason: null,
    });
    expect(castFlowSettings({ recursionLimit: 3 })).toEqual({ recursionLimit: 3, maxParallelism: 5 });
    expect(castTriggerConfig({ kind: 'manual', params: {} })).toEqual({ kind: 'manual' });
    expect(castTriggerConfig({ params: {} })).toBeNull();
    expect(castTriggerConfig(null)).toBeNull();
    expect(castMixedObject({})).toBeNull();
    expect(castMixedObject({ a: { b: {} }, at: new Date('2026-01-01T00:00:00Z'), s: 'x\u0000' })).toEqual({ at: '2026-01-01T00:00:00.000Z', s: 'x' });
  });

  it('casts DTO class instances like plain objects', () => {
    class PortDto { id = 'p'; }
    class NodeDto { id = 'n'; kind = 'step'; input = { ports: [new PortDto()] }; }
    class SettingsDto { recursionLimit = 7; maxParallelism = 2; }
    expect(castFlowNodes([new NodeDto()])).toEqual([{ id: 'n', kind: 'step', input: { ports: [{ id: 'p', required: false }] } }]);
    expect(castFlowSettings(new SettingsDto())).toEqual({ recursionLimit: 7, maxParallelism: 2 });
  });

  it('is idempotent', () => {
    const nodes = castFlowNodes([{ id: 'n', kind: 'step', input: { ports: [{ id: 'p' }] }, hitlPolicy: {} }]);
    expect(castFlowNodes(nodes)).toEqual(nodes);
  });
});
