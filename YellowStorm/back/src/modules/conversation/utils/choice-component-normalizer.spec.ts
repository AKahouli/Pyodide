import { normalizeChoiceComponentData } from './choice-component-normalizer';

const valid = {
  schemaVersion: 1, questionId: 'next-step', prompt: 'Choose a next step', presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate', status: 'ready',
  options: [{ id: 'one', label: 'One', submitText: 'Choose one' }, { id: 'two', label: 'Two', submitText: 'Choose two' }],
};

describe('normalizeChoiceComponentData', () => {
  it('normalizes a valid payload and forces explicit submission for multiple selection', () => {
    const normalized = normalizeChoiceComponentData({ ...valid, selectionMode: 'multiple', labels: { submit: 'Continue' }, progress: { current: 1, total: 2, label: 'Step 1' } });
    expect(normalized?.submitBehavior).toBe('explicit');
    expect(normalized?.labels?.submit).toBe('Continue');
    expect(normalized?.progress).toEqual({ current: 1, total: 2, label: 'Step 1' });
  });

  it('accepts either numeric schema version alias', () => {
    expect(normalizeChoiceComponentData(valid)).not.toBeNull();
    const { schemaVersion: _schemaVersion, ...snakeCase } = valid;
    expect(normalizeChoiceComponentData({ ...snakeCase, schema_version: 1 })).not.toBeNull();
  });

  it('rejects missing, unsupported, and non-numeric schema versions', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = valid;
    expect(normalizeChoiceComponentData(withoutVersion)).toBeNull();
    expect(normalizeChoiceComponentData({ ...valid, schemaVersion: 2 })).toBeNull();
    expect(normalizeChoiceComponentData({ ...valid, schemaVersion: '1' })).toBeNull();
  });

  it('rejects duplicate or unsafe option identifiers', () => {
    expect(normalizeChoiceComponentData({ ...valid, options: [{ ...valid.options[0] }, { ...valid.options[0] }] })).toBeNull();
    expect(normalizeChoiceComponentData({ ...valid, options: [{ ...valid.options[0], id: '<bad>' }, valid.options[1]] })).toBeNull();
  });

  it('rejects missing or unknown statuses rather than making them interactive', () => {
    const { status: _status, ...withoutStatus } = valid;
    expect(normalizeChoiceComponentData(withoutStatus)).toBeNull();
    expect(normalizeChoiceComponentData({ ...valid, status: 'building' })).toBeNull();
    expect(normalizeChoiceComponentData({ ...valid, status: 'READY' })).toBeNull();
  });

  it('preserves only safe HTTPS option URLs', () => {
    expect(normalizeChoiceComponentData({ ...valid, options: [{ ...valid.options[0], url: 'https://example.com/form' }, valid.options[1]] })?.options[0]?.url).toBe('https://example.com/form');
    expect(normalizeChoiceComponentData({ ...valid, options: [{ ...valid.options[0], url: 'javascript:alert(1)' }, valid.options[1]] })?.options[0]?.url).toBeUndefined();
  });
});
