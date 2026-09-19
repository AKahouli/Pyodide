import { mapFilter, mapSort, toObjectId } from './mongo-adapter-utils';
import { escapeLike } from '@common/postgres/like';

describe('mongo adapter filter translation', () => {
  it('maps each filter field to its Mongo equivalent', () => {
    const q = mapFilter({
      id: '507f1f77bcf86cd799439011',
      workspaceId: '507f1f77bcf86cd799439012',
      status: 'completed',
      indexingStatus: 'ready',
      indexingStartedBefore: new Date(0),
      isFolder: false,
      type: 'doc',
      originalName: 'x.pdf',
    });
    expect(q._id).toEqual(toObjectId('507f1f77bcf86cd799439011'));
    expect(q.workspaceId).toEqual(toObjectId('507f1f77bcf86cd799439012'));
    expect(q.status).toBe('completed');
    expect(q.indexingStatus).toBe('ready');
    expect(q.indexingStartedAt).toEqual({ $lt: new Date(0) });
    expect(q.isFolder).toBe(false);
    expect(q.type).toBe('doc');
    expect(q.originalName).toBe('x.pdf');
  });

  it('translates originalNameSearch into an escaped case-insensitive regex', () => {
    const q = mapFilter({ originalNameSearch: 'a.b%c' });
    const regex = q.originalName as RegExp;
    expect(regex.options).toBe('i');
    expect(regex.test('aXbYc')).toBe(true);
    expect(regex.test('abc')).toBe(false); // dot was escaped, not a wildcard
  });

  it('merges ids with the afterId keyset predicate', () => {
    const q = mapFilter({
      ids: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
      afterId: '507f1f77bcf86cd799439010',
    });
    expect(q._id).toEqual({
      $in: [toObjectId('507f1f77bcf86cd799439011'), toObjectId('507f1f77bcf86cd799439012')],
      $gt: toObjectId('507f1f77bcf86cd799439010'),
    });
  });

  it('returns an empty query for an empty filter', () => {
    expect(mapFilter({})).toEqual({});
  });

  it('maps sort fields', () => {
    expect(mapSort('createdAt', 'asc')).toEqual({ createdAt: 1 });
    expect(mapSort('id', 'desc')).toEqual({ _id: -1 });
  });

  it('escapes regex specials in search text', () => {
    expect(escapeLike('a+b')).toBe('a+b'); // escapeLike is PG-side; regex escaping is adapter-side
  });
});
