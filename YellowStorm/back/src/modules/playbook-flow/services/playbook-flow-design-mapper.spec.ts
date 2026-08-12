import { mapGrpcResponseToFlow } from './playbook-flow-design-mapper';

describe('mapGrpcResponseToFlow', () => {
  it('preserves source and target port ids from grpc edges', () => {
    const result = mapGrpcResponseToFlow({
      nodes: [],
      edges: [{
        source_id: 'extract-step',
        target_id: 'summarize-step',
        source_output_port_id: 'text',
        target_input_port_id: 'input',
        router_label: '',
      }],
    });

    expect(result.controlEdges).toEqual([{
      id: 'edge-0',
      kind: 'sequential',
      source: 'extract-step',
      target: 'summarize-step',
      routerLabel: undefined,
      sourceOutputPortId: 'text',
      targetInputPortId: 'input',
    }]);
  });

  it('creates a binding for explicit compatible ports on a generated edge', () => {
    const result = mapGrpcResponseToFlow({
      nodes: [
        {
          id: 'search', kind: 'step', output_ports: [
            { id: 'results', artifact_kind: 'data' },
          ],
        },
        {
          id: 'summarize', kind: 'step', input_ports: [
            { id: 'search-results', artifact_kind: 'data', required: true },
          ], output_ports: [],
        },
      ],
      edges: [{
        source_id: 'search', target_id: 'summarize',
        source_output_port_id: 'results', target_input_port_id: 'search-results',
      }],
    });

    expect(result.dataBindings).toEqual([{
      id: 'binding-["search","results","summarize","search-results"]',
      targetNode: 'summarize',
      targetPort: 'search-results',
      sourceKind: 'node-output',
      sourceNode: 'search',
      sourcePort: 'results',
      iteration: 'current',
    }]);
  });

  it('infers a unique exact-type source port when generated edge port ids are absent', () => {
    const result = mapGrpcResponseToFlow({
      nodes: [
        { id: 'search', output_ports: [{ id: 'results', artifact_kind: 'data' }] },
        { id: 'summarize', input_ports: [{ id: 'input', artifact_kind: 'data', required: true }] },
      ],
      edges: [{ source_id: 'search', target_id: 'summarize' }],
    });

    expect(result.dataBindings).toEqual([
      expect.objectContaining({
        sourceNode: 'search', sourcePort: 'results',
        targetNode: 'summarize', targetPort: 'input',
      }),
    ]);
  });

  it('does not bind optional, incompatible, or ambiguous generated inputs', () => {
    const optional = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source', output_ports: [{ id: 'output', artifact_kind: 'text' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'text', required: false }] },
      ],
      edges: [{ source_id: 'source', target_id: 'target' }],
    });
    const incompatible = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source', output_ports: [{ id: 'image', artifact_kind: 'image' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'text', required: true }] },
      ],
      edges: [{ source_id: 'source', target_id: 'target' }],
    });
    const ambiguous = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source-a', output_ports: [{ id: 'output', artifact_kind: 'text' }] },
        { id: 'source-b', output_ports: [{ id: 'output', artifact_kind: 'text' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'text', required: true }] },
      ],
      edges: [
        { source_id: 'source-a', target_id: 'target' },
        { source_id: 'source-b', target_id: 'target' },
      ],
    });
    const invalidExplicitPort = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source', output_ports: [{ id: 'output', artifact_kind: 'text' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'text', required: true }] },
      ],
      edges: [{
        source_id: 'source', target_id: 'target',
        source_output_port_id: 'missing', target_input_port_id: 'input',
      }],
    });

    expect(optional.dataBindings).toEqual([]);
    expect(incompatible.dataBindings).toEqual([]);
    expect(ambiguous.dataBindings).toEqual([]);
    expect(invalidExplicitPort.dataBindings).toEqual([]);
  });

  it('keeps colon-containing source tuples distinct when checking ambiguity', () => {
    const result = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source:a', output_ports: [{ id: 'out', artifact_kind: 'data' }] },
        { id: 'source', output_ports: [{ id: 'a:out', artifact_kind: 'data' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'data', required: true }] },
      ],
      edges: [
        { source_id: 'source:a', target_id: 'target' },
        { source_id: 'source', target_id: 'target' },
      ],
    });

    expect(result.dataBindings).toEqual([]);
  });

  it('does not infer bindings from unsupported edge kinds', () => {
    const result = mapGrpcResponseToFlow({
      nodes: [
        { id: 'source', output_ports: [{ id: 'output', artifact_kind: 'data' }] },
        { id: 'target', input_ports: [{ id: 'input', artifact_kind: 'data', required: true }] },
      ],
      edges: [{ source_id: 'source', target_id: 'target', kind: 'reference' }],
    });

    expect(result.dataBindings).toEqual([]);
  });
});
