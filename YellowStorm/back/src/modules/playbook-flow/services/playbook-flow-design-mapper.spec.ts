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
});
