import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';

describe('PlaybookFlowValidatorService', () => {
  const service = new PlaybookFlowValidatorService();

  const buildNodes = () => [
    {
      id: 'source-node',
      kind: 'step',
      input: { ports: [] },
      output: { ports: [{ id: 'summary', type: 'text' }] },
    },
    {
      id: 'target-node',
      kind: 'step',
      input: { ports: [{ id: 'prompt', type: 'text', required: true }] },
      output: { ports: [] },
    },
  ] as any;

  const buildRouterNode = (overrides: Record<string, unknown> = {}) => ({
    id: 'router-1',
    kind: 'router',
    input: { ports: [] },
    output: { ports: [] },
    routerConfig: {
      outputLabels: ['retry', 'done'],
      maxIterations: 3,
      defaultLabel: 'done',
      conditions: [],
    },
    ...overrides,
  });

  it('accepts a valid node-output binding', () => {
    expect(() => {
      service.validate(buildNodes(), [{
        id: 'edge-1',
        kind: 'sequential',
        source: 'source-node',
        target: 'target-node',
      }] as any, [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).not.toThrow();
  });

  it('rejects bindings whose source port does not exist', () => {
    expect(() => {
      service.validate(buildNodes(), [], [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'missing',
        iteration: 'current',
      }] as any);
    }).toThrow(BadRequestException);

    expect(() => {
      service.validate(buildNodes(), [], [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'missing',
        iteration: 'current',
      }] as any);
    }).toThrow('Data binding binding-1 source port source-node.missing does not exist');
  });

  it('rejects bindings whose target port does not exist', () => {
    expect(() => {
      service.validate(buildNodes(), [], [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'missing',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).toThrow('Data binding binding-1 target port target-node.missing does not exist');
  });

  it('rejects bindings whose source node cannot reach the target node', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'detached-node',
          kind: 'step',
          input: { ports: [] },
          output: { ports: [{ id: 'result', type: 'text' }] },
        },
      ] as any, [], [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'detached-node',
        sourcePort: 'result',
        iteration: 'current',
      }] as any);
    }).toThrow('Data binding binding-1 source detached-node cannot reach target target-node');
  });

  it('rejects duplicate bindings for the same target port', () => {
    expect(() => {
      service.validate(buildNodes(), [], [
        {
          id: 'binding-1',
          targetNode: 'target-node',
          targetPort: 'prompt',
          sourceKind: 'node-output',
          sourceNode: 'source-node',
          sourcePort: 'summary',
          iteration: 'current',
        },
        {
          id: 'binding-2',
          targetNode: 'target-node',
          targetPort: 'prompt',
          sourceKind: 'constant',
          constantValue: { text: 'fallback' },
        },
      ] as any);
    }).toThrow('Target port target-node.prompt has multiple data bindings');
  });

  it('rejects duplicate control edges for the same logical route', () => {
    expect(() => {
      service.validate(buildNodes(), [
        {
          id: 'edge-1',
          kind: 'sequential',
          source: 'source-node',
          target: 'target-node',
          sourceOutputPortId: 'summary',
          targetInputPortId: 'prompt',
        },
        {
          id: 'edge-2',
          kind: 'sequential',
          source: 'source-node',
          target: 'target-node',
          sourceOutputPortId: 'summary',
          targetInputPortId: 'prompt',
        },
      ] as any, [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).toThrow('Duplicate control edge route: source-node -> target-node');
  });

  it('rejects incompatible source and target artifact kinds', () => {
    const nodes = buildNodes();
    nodes[0].output.ports[0].type = 'document';

    expect(() => {
      service.validate(nodes, [], [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).toThrow('Data binding binding-1 type mismatch: source-node.summary (document) -> target-node.prompt (text)');
  });

  it('rejects deterministic router conditions without a default label', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'router-1',
          kind: 'router',
          input: { ports: [] },
          output: { ports: [] },
          routerConfig: {
            outputLabels: ['valid', 'invalid'],
            maxIterations: 3,
            conditions: [{
              label: 'valid',
              sourceNode: 'source-node',
              sourcePort: 'summary',
              operator: 'equals',
              value: 'ok',
            }],
          },
        },
      ] as any, [], [] as any);
    }).toThrow('Router router-1 requires defaultLabel when deterministic conditions are configured');
  });

  it('rejects deterministic router conditions that reference an unknown source port', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'router-1',
          kind: 'router',
          input: { ports: [] },
          output: { ports: [] },
          routerConfig: {
            outputLabels: ['valid', 'invalid'],
            maxIterations: 3,
            defaultLabel: 'invalid',
            conditions: [{
              label: 'valid',
              sourceNode: 'source-node',
              sourcePort: 'missing',
              operator: 'equals',
              value: 'ok',
            }],
          },
        },
      ] as any, [], [] as any);
    }).toThrow('Router router-1 condition 0 source port source-node.missing does not exist');
  });

  it('rejects deterministic router conditions whose source cannot reach the router', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'router-1',
          kind: 'router',
          input: { ports: [] },
          output: { ports: [] },
          routerConfig: {
            outputLabels: ['valid', 'invalid'],
            maxIterations: 3,
            defaultLabel: 'invalid',
            conditions: [{
              label: 'valid',
              sourceNode: 'source-node',
              sourcePort: 'summary',
              operator: 'equals',
              value: 'ok',
            }],
          },
        },
      ] as any, [], [] as any);
    }).toThrow('Router router-1 condition 0 source source-node cannot reach router');
  });

  it('rejects deterministic router conditions whose source only reaches the router through conditional flow', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'router-2',
          kind: 'router',
          input: { ports: [] },
          output: { ports: [] },
          routerConfig: {
            outputLabels: ['continue'],
            maxIterations: 1,
            conditions: [],
          },
        },
        {
          id: 'router-1',
          kind: 'router',
          input: { ports: [] },
          output: { ports: [] },
          routerConfig: {
            outputLabels: ['valid', 'invalid'],
            maxIterations: 3,
            defaultLabel: 'invalid',
            conditions: [{
              label: 'valid',
              sourceNode: 'source-node',
              sourcePort: 'summary',
              operator: 'equals',
              value: 'ok',
            }],
          },
        },
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'router-2' },
        { id: 'edge-2', kind: 'conditional', source: 'router-2', target: 'router-1', routerLabel: 'continue' },
      ] as any, [] as any);
    }).toThrow('Router router-1 condition 0 source source-node is not guaranteed to run before the router');
  });

  it('rejects cycles that do not include a router', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        {
          id: 'loop-node',
          kind: 'step',
          input: { ports: [] },
          output: { ports: [{ id: 'result', type: 'text' }] },
        },
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'loop-node' },
        { id: 'edge-2', kind: 'sequential', source: 'loop-node', target: 'source-node' },
      ] as any, [] as any);
    }).toThrow('Cycle loop-node -> source-node must include a router');
  });

  it('rejects router cycles without a terminal exit route', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        buildRouterNode(),
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'router-1' },
        { id: 'edge-2', kind: 'conditional', source: 'router-1', target: 'source-node', routerLabel: 'retry' },
        { id: 'edge-3', kind: 'conditional', source: 'router-1', target: 'source-node', routerLabel: 'done' },
      ] as any, [] as any);
    }).toThrow('Router router-1 cycle has no terminal exit route');
  });

  it('accepts router nodes whose implicit labels do not have outgoing edges yet', () => {
    const nodes = buildNodes();
    nodes[1].input.ports = [];

    expect(() => {
      service.validate([
        ...nodes,
        {
          ...buildRouterNode({
            routerConfig: {
              outputLabels: ['retry', 'done', '__error__'],
              maxIterations: 3,
              defaultLabel: 'done',
              conditions: [],
            },
          }),
        },
      ] as any, [] as any, [] as any, { allowDraftRouters: true });
    }).not.toThrow();
  });

  it('still rejects runnable routers when a non-reserved label has no outgoing edge', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        buildRouterNode(),
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'router-1' },
        { id: 'edge-2', kind: 'conditional', source: 'router-1', target: 'target-node', routerLabel: 'done' },
      ] as any, [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).toThrow('Router router-1 label "retry" has no outgoing edge');
  });

  it('rejects router cycles whose router is unbounded', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        buildRouterNode({
          routerConfig: {
            outputLabels: ['retry', 'done'],
            maxIterations: 0,
            defaultLabel: 'done',
            conditions: [],
          },
        }),
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'router-1' },
        { id: 'edge-2', kind: 'conditional', source: 'router-1', target: 'source-node', routerLabel: 'retry' },
        { id: 'edge-3', kind: 'conditional', source: 'router-1', target: 'target-node', routerLabel: 'done' },
      ] as any, [] as any);
    }).toThrow('Cycle router-1 -> source-node must include a router with maxIterations > 0');
  });

  it('accepts router cycles that include a bounded router and a terminal exit route', () => {
    expect(() => {
      service.validate([
        ...buildNodes(),
        buildRouterNode(),
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'source-node', target: 'router-1' },
        { id: 'edge-2', kind: 'conditional', source: 'router-1', target: 'source-node', routerLabel: 'retry' },
        { id: 'edge-3', kind: 'conditional', source: 'router-1', target: 'target-node', routerLabel: 'done' },
      ] as any, [{
        id: 'binding-1',
        targetNode: 'target-node',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'source-node',
        sourcePort: 'summary',
        iteration: 'current',
      }] as any);
    }).not.toThrow();
  });

  it('rejects cycles inside an iterator body', () => {
    expect(() => {
      service.validate([
        {
          id: 'iterator-1',
          kind: 'iterator',
          input: { ports: [] },
          output: { ports: [] },
          metadata: {},
        },
        {
          id: 'child-1',
          kind: 'step',
          input: { ports: [] },
          output: { ports: [] },
          metadata: { containerConfig: { parentIteratorId: 'iterator-1' } },
        },
        {
          id: 'child-2',
          kind: 'step',
          input: { ports: [] },
          output: { ports: [] },
          metadata: { containerConfig: { parentIteratorId: 'iterator-1' } },
        },
      ] as any, [
        { id: 'edge-1', kind: 'sequential', source: 'child-1', target: 'child-2' },
        { id: 'edge-2', kind: 'sequential', source: 'child-2', target: 'child-1' },
      ] as any, [] as any);
    }).toThrow('Iterator iterator-1 body must be acyclic');
  });
});
