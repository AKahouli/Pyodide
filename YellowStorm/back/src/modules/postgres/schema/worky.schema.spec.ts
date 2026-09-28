import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './worky.schema';
import { describeIntegration, makeTestDb } from '../testing/pg-integration';

/**
 * The Drizzle mirror of 0038_worky.sql is hand-written next to the SQL, so a typo on either side would
 * only show as a runtime error in one query. This compares them: every column with its type and
 * nullability, every index and every check constraint.
 */
describeIntegration('worky schema matches migration 0038 (integration)', () => {
  const { pool, close } = makeTestDb();
  afterAll(close);

  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as PgTable[];

  /** information_schema data_type for a drizzle SQL type. */
  const dataType = (sqlType: string): string => {
    if (sqlType.endsWith('[]')) return 'ARRAY';
    if (sqlType.startsWith('char(')) return 'character';
    if (sqlType.startsWith('varchar')) return 'character varying';
    if (sqlType.startsWith('numeric')) return 'numeric';
    if (sqlType.startsWith('timestamp')) return 'timestamp with time zone';
    return sqlType;
  };

  it('finds every worky table', () => {
    expect(tables.length).toBeGreaterThanOrEqual(24);
    expect(tables.every((t) => getTableConfig(t).schema === 'worky')).toBe(true);
  });

  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))('%s has the columns, indexes and checks of the migration', async (name, table) => {
    const config = getTableConfig(table);
    const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'worky' AND table_name = $1`,
      [name],
    );
    const actual = new Map(columns.rows.map((r) => [r.column_name, r]));
    expect([...actual.keys()].sort()).toEqual(config.columns.map((c) => c.name).sort());
    for (const column of config.columns) {
      const row = actual.get(column.name)!;
      expect({ column: column.name, type: row.data_type, notNull: row.is_nullable === 'NO' })
        .toEqual({ column: column.name, type: dataType(column.getSQLType()), notNull: column.notNull });
    }

    const indexes = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'worky' AND tablename = $1`, [name]);
    const declared = config.indexes.map((i) => i.config.name);
    // The primary key index is implicit in the model; every declared index must exist.
    expect(indexes.rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(declared));
    expect(indexes.rows.map((r) => r.indexname).filter((i) => !i.endsWith('_pkey')).sort()).toEqual([...declared].sort());

    const checks = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'worky' AND t.relname = $1 AND c.contype = 'c'`,
      [name],
    );
    expect(checks.rows.map((r) => r.conname).sort()).toEqual(config.checks.map((c) => c.name).sort());
  });
});
