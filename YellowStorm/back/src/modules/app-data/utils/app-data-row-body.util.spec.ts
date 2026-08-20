import { normalizeAppDataRowBody } from './app-data-row-body.util';

describe('normalizeAppDataRowBody', () => {
  it('returns flat row objects without undefined values', () => {
    expect(normalizeAppDataRowBody({ name: 'A', price: 10, note: undefined })).toEqual({
      name: 'A',
      price: 10,
    });
  });

  it('unwraps row and data wrappers', () => {
    expect(normalizeAppDataRowBody({ row: { name: 'B' } })).toEqual({ name: 'B' });
    expect(normalizeAppDataRowBody({ data: { name: 'C' } })).toEqual({ name: 'C' });
  });

  it('throws on null/undefined body with helpful message', () => {
    expect(() => normalizeAppDataRowBody(null)).toThrow('empty body');
    expect(() => normalizeAppDataRowBody(undefined)).toThrow('empty body');
    expect(() => normalizeAppDataRowBody(null, 'text/html')).toThrow('Content-Type: application/json');
  });

  it('returns empty object for non-object payloads', () => {
    expect(normalizeAppDataRowBody([])).toEqual({});
  });
});
