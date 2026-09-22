import { ModelSpecificationService } from './model-specification.service';
import type { ModelSpecification } from '../domain/model-specification.types';

const base = (): Omit<ModelSpecification, 'specHash'> => ({
  modelId: 'model-1',
  modelVersionId: 'v1',
  homeWorkspaceId: 'ws-1',
  concepts: [
    {
      conceptId: 'c-customer',
      key: 'customer',
      label: 'Customer',
      identity: { namespace: 'customer', keyComponents: ['customer_id'] },
      populationMode: 'filtered_materialized' as const,
      eligibility: { field: 'country', op: 'eq' as const, value: 'FR' },
      materialization: { field: 'country', op: 'eq' as const, value: 'FR' },
      allowedFields: ['customer_id', 'country'],
    },
  ],
  relations: [
    {
      relationId: 'r-1',
      key: 'has_contract',
      label: 'has contract',
      sourceConceptId: 'c-customer',
      targetConceptId: 'c-customer',
      cardinality: 'one_to_many' as const,
      matchingStrategy: 'exact' as const,
    },
  ],
  sourceScope: [{ workspaceId: 'ws-1', assetId: 'a-1' }],
});

describe('ModelSpecificationService (P1)', () => {
  const svc = new ModelSpecificationService();

  it('round-trips eligibility vs materialization and hashes deterministically', () => {
    const a = svc.buildSnapshot(base());
    const b = svc.buildSnapshot({ ...base(), concepts: [...base().concepts].reverse() });
    expect(a.specHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.specHash).toBe(b.specHash);
    expect(svc.validate(base())).toEqual([]);
  });

  it('hashes identically regardless of property insertion order and concept order', () => {
    const one = base();
    one.concepts.push({
      conceptId: 'c-contract',
      key: 'contract',
      label: 'Contract',
      identity: { namespace: 'contract', keyComponents: ['contract_id'] },
      populationMode: 'materialized',
      allowedFields: ['contract_id'],
    });
    const reordered = JSON.parse(
      JSON.stringify({ ...one, concepts: [...one.concepts].reverse() }),
      // revive with shuffled key order to simulate different construction order
      (k, v) => v,
    ) as typeof one;
    const shuffled = {
      sourceScope: reordered.sourceScope,
      relations: reordered.relations,
      homeWorkspaceId: reordered.homeWorkspaceId,
      modelVersionId: reordered.modelVersionId,
      modelId: reordered.modelId,
      concepts: reordered.concepts,
    };
    expect(svc.buildSnapshot(one).specHash).toBe(svc.buildSnapshot(shuffled).specHash);
  });

  it('rejects blank identity key components', () => {
    const bad = base();
    bad.concepts[0] = { ...bad.concepts[0], identity: { namespace: 'customer', keyComponents: [' '] } };
    expect(svc.validate(bad).map((i) => i.code)).toContain('empty_identity_key');
  });

  it('preserves identity on rename (same conceptId, new label)', () => {
    const renamed = base();
    renamed.concepts[0] = { ...renamed.concepts[0], label: 'Client' };
    const snap = svc.buildSnapshot(renamed);
    expect(snap.concepts[0].conceptId).toBe('c-customer');
    expect(snap.concepts[0].label).toBe('Client');
  });

  it('rejects unsupported relation endpoints and empty scope', () => {
    const bad = base();
    bad.relations[0] = { ...bad.relations[0], targetConceptId: 'c-missing' };
    bad.sourceScope = [];
    const codes = svc.validate(bad).map((i) => i.code);
    expect(codes).toContain('unknown_relation_endpoint');
    expect(codes).toContain('empty_source_scope');
  });

  it('requires eligibility when materialization is set (no silent cap)', () => {
    const bad = base();
    bad.concepts[0] = { ...bad.concepts[0], eligibility: null };
    expect(svc.validate(bad).map((i) => i.code)).toContain('materialization_without_eligibility');
  });

  it('orders mixed-case ids by code unit, independent of locale', () => {
    const mixed = base();
    mixed.concepts.push(
      {
        conceptId: 'C-10',
        key: 'upper',
        label: 'Upper',
        identity: { namespace: 't', keyComponents: ['id'] },
        populationMode: 'materialized',
        allowedFields: ['id'],
      },
      {
        conceptId: 'c-2',
        key: 'lower',
        label: 'Lower',
        identity: { namespace: 't', keyComponents: ['id'] },
        populationMode: 'materialized',
        allowedFields: ['id'],
      },
    );
    const forward = svc.buildSnapshot(mixed).specHash;
    const backward = svc.buildSnapshot({ ...mixed, concepts: [...mixed.concepts].reverse() });
    expect(backward.specHash).toBe(forward);
    // Code-unit order: 'C-10' (0x43…) precedes 'c-2' (0x63…) and 'c-customer'.
    const snap = svc.buildSnapshot(mixed);
    expect(snap.concepts.map((c) => c.conceptId)).toEqual(['C-10', 'c-2', 'c-customer']);
  });

  it('declaration creates no instance edges (spec carries zero instances)', () => {
    const snap = svc.buildSnapshot(base());
    expect(JSON.stringify(snap)).not.toContain('recordRelations');
    expect(snap.relations).toHaveLength(1);
  });
});
