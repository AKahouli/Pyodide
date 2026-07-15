import { DecisionFlowValidatorService } from './decision-flow-validator.service';

describe('DecisionFlowValidatorService', () => {
  const service = new DecisionFlowValidatorService();
  const valid = {
    title: 'Eligibility',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'edge', source: 'start', target: 'end' }],
  };

  it('accepts a connected payload with exactly one start node', () => {
    expect(service.validate(valid)).toEqual(valid);
  });

  it('rejects dangling edges', () => {
    expect(() => service.validate({ ...valid, edges: [{ id: 'edge', source: 'start', target: 'missing' }] })).toThrow();
  });

  it('rejects multiple start nodes', () => {
    expect(() => service.validate({ ...valid, nodes: [...valid.nodes, { id: 'start-2', type: 'start', label: 'Other' }] })).toThrow();
  });
});
