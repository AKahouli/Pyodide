import { identityIssue, labelFieldIssue, mappingIssues, ModelIssueException, relationRuleIssue } from './semantic-model-check';

const NODES = [
  { id: 'c-customer', key: 'customer', label: 'Customer', attributes: [
    { key: 'customer_id', label: 'Id', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'age', label: 'Age', type: 'number' }] },
  { id: 'c-contract', key: 'contract', label: 'Contract', attributes: [
    { key: 'contract_id', label: 'Id', type: 'text' }, { key: 'customer_ref', label: 'Customer', type: 'text' }] },
] as never[];

const mapping = (fieldMappings: unknown[], overrides: Record<string, unknown> = {}) => ({
  id: 'm-1', conceptId: 'c-customer', assetKind: 'excel_sheet', identityFields: ['customer_id'], fieldMappings, ...overrides,
}) as never;

describe('model check rules', () => {
  it('accepts a mapping that reads every identity field', () => {
    expect(mappingIssues(mapping([{ sourceField: 'id', targetAttribute: 'customer_id', mode: 'direct' }]), NODES[0])).toEqual([]);
  });

  it('lists every rule a mapping breaks, each on its field, as a warning because a run skips the mapping', () => {
    const issues = mappingIssues(mapping([
      { sourceField: 'a', targetAttribute: 'gone', mode: 'direct' },
      { sourceField: 'b', targetAttribute: 'name', mode: 'metadata' },
      { sourceField: 'c', targetAttribute: 'name', mode: 'direct' },
    ]), NODES[0]);
    expect(issues.map((issue) => [issue.code, issue.fieldId, issue.severity])).toEqual([
      ['mapping_attribute_missing', 'gone', 'warning'],
      ['mapping_mode_unsupported', 'name', 'warning'],
      ['mapping_duplicate_target', 'name', 'warning'],
      ['unmapped_identity', 'customer_id', 'warning'],
    ]);
    expect(issues.every((issue) => issue.mappingId === 'm-1' && issue.conceptId === 'c-customer')).toBe(true);
    expect(issues[0].message).toBe('The mapping targets an attribute that is not present in the current draft');
  });

  it('asks a sheet to read something, but not a document', () => {
    const none = [{ targetAttribute: 'customer_id', mode: 'ignore' }];
    expect(mappingIssues(mapping(none, { identityFields: [] }), NODES[0]).map((issue) => issue.reason)).toEqual(['no_fields']);
    expect(mappingIssues(mapping(none, { identityFields: [], assetKind: 'document' }), NODES[0])).toEqual([]);
  });

  it('counts a fixed value or a recipe as something read', () => {
    const fixed = [{ targetAttribute: 'customer_id', mode: 'constant', constantValue: 'x' }];
    const recipe = [{ targetAttribute: 'customer_id', mode: 'computed', computed: { input: { kind: 'file' } } }];
    expect(mappingIssues(mapping(fixed), NODES[0])).toEqual([]);
    expect(mappingIssues(mapping(recipe), NODES[0])).toEqual([]);
  });

  it('asks for a label field that is still a field of the concept', () => {
    expect(labelFieldIssue(NODES[0], 'name')).toBeNull();
    expect(labelFieldIssue(NODES[0], undefined)).toMatchObject({ severity: 'error', code: 'missing_label_field', conceptId: 'c-customer' });
    expect(labelFieldIssue(NODES[0], 'removed')?.message).toBe('Choose the field that names each Customer record (its label). Open Review to choose it.');
  });

  it('names the concept with no usable identity', () => {
    expect(identityIssue(NODES[1])).toMatchObject({ severity: 'error', code: 'no_identity', conceptId: 'c-contract', message: 'Concept "Contract" has no usable identity fields' });
  });

  const relation = { id: 'r-1', key: 'owns', sourceNodeTypeId: 'c-contract', targetNodeTypeId: 'c-customer' };
  const rule = (sourceAttribute: string, targetAttribute: string) => ({ sourceAttribute, targetAttribute });

  it('accepts a link whose two fields exist, are filled and have the same type', () => {
    expect(relationRuleIssue({ relation, rule: rule('customer_ref', 'customer_id'), sourceFieldMapped: true, targetFieldMapped: true }, NODES)).toBeNull();
  });

  it('says which side of a link is wrong, in the words of the model', () => {
    const issue = (sourceAttribute: string, targetAttribute: string, sourceFieldMapped = true, targetFieldMapped = true) =>
      relationRuleIssue({ relation, rule: rule(sourceAttribute, targetAttribute), sourceFieldMapped, targetFieldMapped }, NODES);
    expect(issue('gone', 'customer_id')).toMatchObject({ code: 'relation_rule_field_missing', conceptId: 'c-contract', fieldId: 'gone', relationId: 'r-1',
      message: 'Link "owns" matches records on "gone", which is no longer a field of Contract. Open Review to fix it.' });
    expect(issue('customer_ref', 'customer_id', false)).toMatchObject({ code: 'relation_rule_unmapped', conceptId: 'c-contract', fieldId: 'customer_ref' });
    expect(issue('customer_ref', 'customer_id', true, false)).toMatchObject({ code: 'relation_rule_unmapped', conceptId: 'c-customer', fieldId: 'customer_id' });
    expect(issue('customer_ref', 'age')).toMatchObject({ code: 'relation_rule_type_mismatch', relationId: 'r-1',
      message: 'Link "owns" matches a text field with a number field. Open Review to fix it.' });
  });

  it('is a validation failure to a caller that only reads the message', () => {
    const error = new ModelIssueException([identityIssue(NODES[1])]);
    expect(error.message).toBe('Concept "Contract" has no usable identity fields');
    expect(error.issues).toHaveLength(1);
  });
});
