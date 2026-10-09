import { describe, expect, it } from 'vitest';
import type { ModelCheck, ModelCheckIssue } from '../types';
import { checkBlockReason, checkTarget, groupModelCheck, indexModelCheck, issueText, sortIssues, worstSeverity } from './model-check';

const issue = (overrides: Partial<ModelCheckIssue>): ModelCheckIssue => ({ severity: 'error', code: 'no_identity', message: 'English fallback', ...overrides });
const check = (issues: ModelCheckIssue[]): ModelCheck => ({
  modelId: 'model', versionKey: 'v1', checkedAt: '2026-01-01T00:00:00Z',
  errorCount: issues.filter((item) => item.severity === 'error').length,
  warningCount: issues.filter((item) => item.severity === 'warning').length,
  issues,
});

describe('checkTarget', () => {
  it('opens a source link before a derived source, a relationship, then the concept', () => {
    expect(checkTarget(issue({ conceptId: 'c', relationId: 'r', sourceId: 's', mappingId: 'm' }))).toEqual({ kind: 'mapping', id: 'm' });
    expect(checkTarget(issue({ conceptId: 'c', relationId: 'r', sourceId: 's' }))).toEqual({ kind: 'source', id: 's' });
    expect(checkTarget(issue({ conceptId: 'c', relationId: 'r' }))).toEqual({ kind: 'relation', id: 'r' });
    expect(checkTarget(issue({ conceptId: 'c', fieldId: 'f' }))).toEqual({ kind: 'concept', id: 'c' });
    expect(checkTarget(issue({}))).toEqual({ kind: 'model', id: '' });
  });
});

describe('severity ranking', () => {
  it('puts errors before warnings and keeps the server order inside each', () => {
    const sorted = sortIssues([
      issue({ severity: 'warning', code: 'w1' }), issue({ code: 'e1' }), issue({ severity: 'warning', code: 'w2' }), issue({ code: 'e2' }),
    ]);
    expect(sorted.map((item) => item.code)).toEqual(['e1', 'e2', 'w1', 'w2']);
  });

  it('reads the worst severity, or none', () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([issue({ severity: 'warning' })])).toBe('warning');
    expect(worstSeverity([issue({ severity: 'warning' }), issue({})])).toBe('error');
  });
});

describe('groupModelCheck', () => {
  it('groups by the element each issue is fixed on, groups with an error first', () => {
    const groups = groupModelCheck([
      issue({ severity: 'warning', code: 'relation_without_rule', relationId: 'rel' }),
      issue({ code: 'no_identity', conceptId: 'customer' }),
      issue({ code: 'unmapped_identity', conceptId: 'customer', fieldId: 'id' }),
      issue({ severity: 'warning', code: 'missing_label_field', conceptId: 'order' }),
      issue({ code: 'mapping_attribute_missing', conceptId: 'customer', mappingId: 'map-1' }),
    ]);
    expect(groups.map((group) => `${group.kind}:${group.id}:${group.severity}`)).toEqual([
      'concept:customer:error', 'mapping:map-1:error', 'concept:order:warning', 'relation:rel:warning',
    ]);
    expect(groups[0].issues.map((item) => item.code)).toEqual(['no_identity', 'unmapped_identity']);
  });
});

describe('indexModelCheck', () => {
  it('lists an issue on every element it names, so a concept shows what its links and fields suffer', () => {
    const index = indexModelCheck([
      issue({ code: 'mapping_attribute_missing', conceptId: 'customer', mappingId: 'map-1' }),
      issue({ severity: 'warning', code: 'relation_without_rule', relationId: 'rel', conceptId: 'order' }),
      issue({ code: 'chained_derivation', sourceId: 'derived-1', conceptId: 'order' }),
    ]);
    expect(index.concepts.customer).toHaveLength(1);
    expect(index.concepts.order.map((item) => item.code)).toEqual(['chained_derivation', 'relation_without_rule']);
    expect(index.mappings['map-1']).toHaveLength(1);
    expect(index.relations.rel).toHaveLength(1);
    expect(index.sources['derived-1']).toHaveLength(1);
  });

  it('is empty without issues', () => {
    expect(indexModelCheck(undefined)).toEqual({ concepts: {}, relations: {}, mappings: {}, sources: {} });
  });
});

describe('issueText', () => {
  const translate = (messages: Record<string, string>) => (keys: string | string[], options: Record<string, unknown> = {}) => {
    const found = [keys].flat().find((key) => key in messages);
    const template = found ? messages[found] : String(options.defaultValue ?? '');
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
  };

  it('prefers the message of the reason, then the code, then the server text', () => {
    const t = translate({ 'check.no_identity': 'Code text', 'check.no_identity.no_sources': 'Reason text' });
    expect(issueText(t, issue({ reason: 'no_sources' }))).toBe('Reason text');
    expect(issueText(t, issue({ reason: 'other' }))).toBe('Code text');
    expect(issueText(t, issue({ code: 'brand_new' }))).toBe('English fallback');
  });

  it('fills the message from the params and tolerates missing ones', () => {
    const t = translate({ 'check.unmapped_identity': 'Field {{field}} is empty. {{detail}}' });
    expect(issueText(t, issue({ code: 'unmapped_identity', params: { field: 'email', detail: 'No source.' } }))).toBe('Field email is empty. No source.');
    expect(issueText(t, issue({ code: 'unmapped_identity' }))).toBe('Field  is empty.');
  });
});

describe('checkBlockReason', () => {
  const t = (keys: string | string[], options: Record<string, unknown> = {}) => [keys].flat()[0] === 'check.blocked' ? `Fix ${options.count} errors first:` : String(options.defaultValue);

  it('does not hold anything back without a result, with no issue or with warnings only', () => {
    expect(checkBlockReason(undefined, t)).toBeNull();
    expect(checkBlockReason(check([]), t)).toBeNull();
    expect(checkBlockReason(check([issue({ severity: 'warning' })]), t)).toBeNull();
  });

  it('says how many errors to fix and names the first', () => {
    const result = check([issue({ severity: 'warning', message: 'Just a warning' }), issue({ message: 'First error' }), issue({ message: 'Second error' })]);
    expect(checkBlockReason(result, t)).toBe('Fix 2 errors first: First error');
  });
});
