import { describe, expect, it } from 'vitest';
import { suggestSourceField } from './DerivedSourceDrawer';

const field = (key: string, label = key.replaceAll('_', ' ')) => ({ key, label });

describe('suggestSourceField', () => {
  const contract = [field('contract_number'), field('customer_id'), field('customer_name'), field('effective_date')];

  it('pairs a field with the source field whose name ends with it', () => {
    expect(suggestSourceField(field('id'), contract)).toBe('customer_id');
    expect(suggestSourceField(field('name'), contract)).toBe('customer_name');
  });

  it('prefers the same name, and suggests nothing without a match', () => {
    expect(suggestSourceField(field('contract_number'), contract)).toBe('contract_number');
    expect(suggestSourceField(field('country'), contract)).toBeUndefined();
  });

  it('reads labels too, and takes the shortest match', () => {
    expect(suggestSourceField({ key: 'raison_sociale', label: 'Name' }, [field('supplier_trade_name'), field('supplier_name')])).toBe('supplier_name');
  });
});
