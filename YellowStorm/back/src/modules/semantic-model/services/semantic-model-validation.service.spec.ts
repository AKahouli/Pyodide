import { SemanticGraph } from '../domain/semantic-model.types';
import { SemanticModelValidationService } from './semantic-model-validation.service';

describe('SemanticModelValidationService', () => {
  const service = new SemanticModelValidationService();

  function graph(): SemanticGraph {
    return {
      modelId: 'model',
      versionId: 'version',
      revision: 0,
      nodes: [{
        id: 'party', key: 'party', label: 'Party', description: 'A contracting party',
        category: 'business_object', recordPolicy: 'optional', systemKey: null,
        aliases: [], attributes: [], position: { x: 0, y: 0 },
      }],
      relations: [], records: [], recordRelations: [],
    };
  }

  it('allows a structure-only model when records are optional', () => {
    expect(service.validate(graph()).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('warns rather than blocks when expected records are missing', () => {
    const input = graph();
    input.nodes[0].recordPolicy = 'expected';
    expect(service.validate(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'expected_records_missing', severity: 'warning' }),
    ]));
  });

  it('names the concept a finding is about', () => {
    const input = graph();
    input.nodes[0].recordPolicy = 'expected';
    expect(service.validate(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'expected_records_missing', targetId: 'party', targetLabel: 'Party' }),
    ]));
  });

  it('names the relationship a finding is about', () => {
    const input = graph();
    input.relations.push({
      id: 'relation', key: 'participates_in', label: 'Participates in', inverseLabel: '',
      description: '', sourceNodeTypeId: 'party', targetNodeTypeId: 'missing',
      cardinality: 'many_to_many', traversable: true, filterable: true, attributes: [],
    });
    expect(service.validate(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_relation_endpoint', targetLabel: 'Participates in' }),
    ]));
  });

  it('blocks relationships whose endpoints do not exist', () => {
    const input = graph();
    input.relations.push({
      id: 'relation', key: 'participates_in', label: 'Participates in', inverseLabel: '',
      description: '', sourceNodeTypeId: 'party', targetNodeTypeId: 'missing',
      cardinality: 'many_to_many', traversable: true, filterable: true, attributes: [],
    });
    expect(service.validate(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_relation_endpoint', severity: 'error' }),
    ]));
  });
});
