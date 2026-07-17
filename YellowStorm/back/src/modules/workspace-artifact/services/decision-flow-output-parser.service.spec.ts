import { DecisionFlowOutputParserService } from './decision-flow-output-parser.service';

describe('DecisionFlowOutputParserService', () => {
  const service = new DecisionFlowOutputParserService();

  it('parses raw JSON and one JSON fence', () => {
    expect(service.parse('{"nodes":[]}')).toEqual({ nodes: [] });
    expect(service.parse('```json\n{"edges":[]}\n```')).toEqual({ edges: [] });
  });

  it('rejects prose surrounding JSON', () => {
    expect(() => service.parse('Here is the result: {"nodes":[]}')).toThrow();
  });
});
