import { pageOf, pageParams } from './pagination';

describe('pageParams', () => {
  it('applies defaults', () => {
    expect(pageParams({})).toEqual({ limit: 20, offset: 0 });
  });

  it('clamps limit into [1, 100] and offset to >= 0', () => {
    expect(pageParams({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(pageParams({ limit: 5000 })).toEqual({ limit: 100, offset: 0 });
    expect(pageParams({ limit: 10, offset: -5 })).toEqual({ limit: 10, offset: 0 });
  });

  it('honors in-range values', () => {
    expect(pageParams({ limit: 50, offset: 100 })).toEqual({ limit: 50, offset: 100 });
  });
});

describe('pageOf', () => {
  it('strips the total column and coerces the bigint count', () => {
    const { items, total } = pageOf([
      { id: 'a', total: '2' },
      { id: 'b', total: '2' },
    ]);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(total).toBe(2);
  });

  it('reports total 0 for an empty page', () => {
    expect(pageOf([])).toEqual({ items: [], total: 0 });
  });
});
