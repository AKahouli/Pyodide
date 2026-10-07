import * as fs from 'fs';
import * as path from 'path';
import { newObjectId } from '@common/postgres';
import { describeIntegration, makeTestDb } from './testing/pg-integration';

/**
 * Migration 0041 must succeed whatever the data looks like: it runs at the start of the deploy, before the
 * playbook backfill, so classifier runs pointing at playbooks that are not there yet are the normal case.
 * The constraint is then added NOT VALID (enforced for new writes) and validated once the orphans are gone.
 * Both branches run on the real file, inside a transaction that is rolled back.
 */
describeIntegration('0041_classifier_runs_playbook_fk on dirty data (integration)', () => {
  const { pool, close } = makeTestDb();
  const migration = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'drizzle', '0041_classifier_runs_playbook_fk.sql'), 'utf8');
  const NAME = 'fk_classifier_runs_playbook';

  afterAll(async () => {
    await close();
  });

  const validated = async (client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: { valid: boolean }[] }> }): Promise<boolean | undefined> =>
    (await client.query('SELECT convalidated AS valid FROM pg_constraint WHERE conname = $1', [NAME])).rows[0]?.valid;

  it('stays NOT VALID while a run points at a missing playbook, still refuses new ones, and validates once it is gone', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = newObjectId();
      const workspaceId = newObjectId();
      await client.query(`INSERT INTO identity.users (id, email, password_hash, email_verified, status) VALUES ($1, $2, 'hash', true, 'active')`, [userId, `fk41-${userId.slice(-8)}@example.com`]);
      await client.query(
        `INSERT INTO workspace.workspaces (id, name, alias, storage_prefix, created_by, allocated_storage) VALUES ($1, $2, $3, $4, $5, 1)`,
        [workspaceId, `fk41 ${workspaceId}`, `fk41-${workspaceId}`, `fk41-${workspaceId}`, userId],
      );
      const insertRun = (id: string, playbookId: string) =>
        client.query(`INSERT INTO classifier.runs (id, workspace_id, playbook_id, triggered_by) VALUES ($1, $2, $3, $4)`, [id, workspaceId, playbookId, userId]);

      // The state before the migration, with a run of a playbook that is not there.
      await client.query(`ALTER TABLE classifier.runs DROP CONSTRAINT IF EXISTS ${NAME}`);
      const orphanRun = newObjectId();
      await insertRun(orphanRun, newObjectId());

      await client.query(migration);
      expect(await validated(client)).toBe(false);

      await client.query('SAVEPOINT refused');
      await expect(insertRun(newObjectId(), newObjectId())).rejects.toThrow(/foreign key/i);
      await client.query('ROLLBACK TO SAVEPOINT refused');

      // Idempotent; with the orphan gone it validates, and a run of a real playbook is accepted.
      await client.query(migration);
      expect(await validated(client)).toBe(false);
      await client.query('DELETE FROM classifier.runs WHERE id = $1', [orphanRun]);
      await client.query(migration);
      expect(await validated(client)).toBe(true);

      const flowId = newObjectId();
      await client.query(`INSERT INTO playbook.flows (id, owner_id, name) VALUES ($1, $2, 'fk41 flow')`, [flowId, userId]);
      await insertRun(newObjectId(), flowId);
      // Deleting the playbook takes its classifier runs with it.
      await client.query('DELETE FROM playbook.flows WHERE id = $1', [flowId]);
      expect((await client.query('SELECT count(*)::int AS n FROM classifier.runs WHERE playbook_id = $1', [flowId])).rows[0]).toEqual({ n: 0 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
