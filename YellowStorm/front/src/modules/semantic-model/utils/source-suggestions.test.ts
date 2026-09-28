import { describe, expect, it } from 'vitest';
import type { SheetFieldProfile } from '../types';
import { guessType, suggestKey, suggestModel, type SheetSample } from './source-suggestions';

const field = (name: string, uniqueRatio = 1, populatedRatio = 1, type: SheetFieldProfile['type'] = 'text'): SheetFieldProfile => ({ name, type, sample: '', populatedRatio, uniqueRatio });

const customers: SheetSample = {
  sheet: 'Customers',
  fields: [field('Name'), field('Customer number'), field('Active', 0.5)],
  sampleRows: [
    { Name: 'Acme', 'Customer number': 'C1', Active: 'yes' },
    { Name: 'Globex', 'Customer number': 'C2', Active: 'no' },
    { Name: 'Initech', 'Customer number': 'C3', Active: 'yes' },
  ],
};
const contracts: SheetSample = {
  sheet: 'Contracts',
  fields: [field('Contract ref'), field('Client', 0.67), field('Amount', 0.67), field('Signed on')],
  sampleRows: [
    { 'Contract ref': 'K1', Client: 'C1', Amount: '100', 'Signed on': '2024-01-02' },
    { 'Contract ref': 'K2', Client: 'C1', Amount: '250.5', 'Signed on': '2024-02-03' },
    { 'Contract ref': 'K3', Client: 'C3', Amount: '100', 'Signed on': '2024-03-04' },
  ],
};

describe('source suggestions', () => {
  it('guesses types from sampled values', () => {
    expect(guessType(['1', '2.5', '-3'])).toBe('number');
    expect(guessType(['2024-01-02', '2025-12-31'])).toBe('date');
    expect(guessType(['yes', 'No'])).toBe('boolean');
    expect(guessType(['Acme', '12'])).toBe('text');
    expect(guessType([], 'number')).toBe('number');
  });

  it('prefers an id-like column that is unique and always filled as key', () => {
    expect(suggestKey(customers)).toBe('Customer number');
    expect(suggestKey({ sheet: 'x', fields: [field('Label', 0.5)], sampleRows: [{ Label: 'a' }, { Label: 'a' }] })).toBeNull();
  });

  it('proposes one concept per sheet and links a column holding another sheet key', () => {
    const { concepts, relations } = suggestModel([customers, contracts]);
    expect(concepts.map((concept) => concept.label)).toEqual(['Customer', 'Contract']);
    expect(concepts[1]).toMatchObject({ keyColumn: 'Contract ref' });
    expect(concepts[1].fields.map((item) => [item.key, item.type])).toEqual([
      ['contract_ref', 'text'], ['client', 'text'], ['amount', 'number'], ['signed_on', 'date'],
    ]);
    expect(concepts[0].fields.find((item) => item.column === 'Active')?.type).toBe('boolean');
    expect(relations).toEqual([{ fromSheet: 'Contracts', fromColumn: 'Client', toSheet: 'Customers' }]);
  });

  it('links by name when the column is called after the other sheet and its key', () => {
    const orders: SheetSample = { sheet: 'Orders', fields: [field('Order id'), field('Customer number', 0.5)], sampleRows: [{ 'Order id': 'O1', 'Customer number': 'Z9' }, { 'Order id': 'O2', 'Customer number': 'Z9' }] };
    expect(suggestModel([customers, orders]).relations).toEqual([{ fromSheet: 'Orders', fromColumn: 'Customer number', toSheet: 'Customers' }]);
  });
});
