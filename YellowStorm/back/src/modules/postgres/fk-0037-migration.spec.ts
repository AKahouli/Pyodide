import * as fs from 'fs';
import * as path from 'path';
import { newObjectId } from '@common/postgres';
import { describeIntegration, makeTestDb } from './testing/pg-integration';

/**
 * Migration 0037 must succeed whatever the data looks like: a constraint whose orphan check is empty is
 * validated, one that still has orphans is added NOT VALID (already enforced for new writes) and left for
 * the runner script. Both branches run here on the real file, inside a transaction that is rolled back.
 */
describeIntegration('0037_conversation_app_runtime_fks on dirty data (integration)', () => {
  const { pool, close } = makeTestDb();
  const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'drizzle', '0037_conversation_app_runtime_fks.sql'), 'utf8');
  const NAME = 'fk_c2_sessions_owner';

  afterAll(async () => {
    await close();
  });

  const state = async (client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ valid: boolean }> }> }, name: string) =>
    (await client.query('SELECT convalidated AS valid FROM pg_constraint WHERE conname = $1', [name])).rows[0]?.valid;

  it('leaves the constraint NOT VALID while an orphan exists, enforces it on new rows, and validates once the orphan is gone', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Start from the state before the migration for this one constraint, with an orphan in place.
      await client.query(`ALTER TABLE conversation_v2.sessions DROP CONSTRAINT IF EXISTS ${NAME}`);
      const orphanId = newObjectId();
      await client.query(`INSERT INTO conversation_v2.sessions (id, owner_id) VALUES ($1, $2)`, [orphanId, newObjectId()]);

      await client.query(migration);
      expect(await state(client, NAME)).toBe(false);

      // NOT VALID still rejects a new row with an unknown owner.
      await client.query('SAVEPOINT refused');
      await expect(client.query(`INSERT INTO conversation_v2.sessions (id, owner_id) VALUES ($1, $2)`, [newObjectId(), newObjectId()])).rejects.toThrow(/foreign key/i);
      await client.query('ROLLBACK TO SAVEPOINT refused');

      // Running it again changes nothing (idempotent); with the orphan gone it validates.
      await client.query(migration);
      expect(await state(client, NAME)).toBe(false);
      await client.query('DELETE FROM conversation_v2.sessions WHERE id = $1', [orphanId]);
      await client.query(migration);
      expect(await state(client, NAME)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('is a no-op on a database that already has every constraint', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration);
      const constraints = await client.query("SELECT conname FROM pg_constraint WHERE conname LIKE 'fk\\_c2\\_%' OR conname LIKE 'fk\\_ar\\_%'");
      expect(constraints.rows.length).toBeGreaterThanOrEqual(12);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
