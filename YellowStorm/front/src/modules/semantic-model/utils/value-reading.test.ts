import { describe, expect, it } from 'vitest';
import { valueReadingParts } from './value-reading';

const t = (key: string, options?: Record<string, string | number>) => `${key}${options ? JSON.stringify(options) : ''}`;

describe('valueReadingParts', () => {
  it('says every column a joined recipe read', () => {
    expect(valueReadingParts({ method: 'direct_mapping', sources: ['First', 'Last'] }, t))
      .toEqual(['dataPreview.builtFrom{"fields":"First + Last"}']);
  });

  it('says nothing more for a recipe on its own column', () => {
    expect(valueReadingParts({ method: 'direct_mapping', reference: 'Email', sources: ['Email'] }, t)).toEqual([]);
  });

  it('names the record, field and method of a value taken from another concept', () => {
    const parts = valueReadingParts(
      { method: 'direct_mapping', derivedFrom: { conceptId: 'c1', label: 'Ada', attribute: 'email', method: 'rules', records: 3 } },
      t, (id) => (id === 'c1' ? 'Contact' : undefined), (_concept, key) => (key === 'email' ? 'E-mail' : key));
    expect(parts).toEqual([
      'dataPreview.takenFrom{"concept":"Contact","record":"Ada"}',
      'dataPreview.takenField{"field":"E-mail"}',
      'dataPreview.readRules',
      'dataPreview.takenRecords{"count":3}',
    ]);
  });
});
