import { isForeignKeyViolation, isUniqueViolation } from './errors';

describe('isUniqueViolation', () => {
  const pgErr = { code: '23505', constraint: 'uq_projects_owner_name' };

  it('detects a raw pg unique violation', () => {
    expect(isUniqueViolation(pgErr)).toBe(true);
  });

  it('detects a drizzle-wrapped violation via cause', () => {
    expect(isUniqueViolation(Object.assign(new Error('Failed query'), { cause: pgErr }))).toBe(true);
  });

  it('filters by constraint name', () => {
    expect(isUniqueViolation(pgErr, 'uq_projects_owner_name')).toBe(true);
    expect(isUniqueViolation(pgErr, 'other')).toBe(false);
  });

  it('ignores other errors', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('detects a raw pg foreign-key violation and a drizzle-wrapped one', () => {
    expect(isForeignKeyViolation({ code: '23503', constraint: 'fk' })).toBe(true);
    expect(isForeignKeyViolation(Object.assign(new Error('Failed query'), { cause: { code: '23503' } }))).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});
