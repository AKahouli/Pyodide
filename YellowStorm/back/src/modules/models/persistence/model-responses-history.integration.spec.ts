import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';

describeIntegration('model Responses controls migration', () => {
  it('defaults existing rows and enforces supported settings and provider replay', async () => {
    const { pool, close } = makeTestDb();
    const client = await pool.connect();
    const schema = `test_responses_${randomBytes(8).toString('hex')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".ai_models (id text PRIMARY KEY, conversation_api text DEFAULT 'chat_completions')`);
      await client.query(`INSERT INTO "${schema}".ai_models (id) VALUES ('existing')`);
      const migration = readFileSync(resolve(process.cwd(), 'drizzle/0051_model_responses_history_controls.sql'), 'utf8');
      await client.query(migration.replaceAll('"catalog"', `"${schema}"`));
      expect((await client.query(`SELECT responses_history_mode, reasoning_history, reasoning_summary FROM "${schema}".ai_models`)).rows[0])
        .toEqual({ responses_history_mode: 'application', reasoning_history: 'auto', reasoning_summary: 'off' });
      await client.query(`UPDATE "${schema}".ai_models SET conversation_api='responses', responses_history_mode='provider'`);
      for (const assignment of ["reasoning_history='last'", "reasoning_summary='invalid'", "responses_history_mode='invalid'"]) {
        await client.query('SAVEPOINT invalid_setting');
        await expect(client.query(`UPDATE "${schema}".ai_models SET ${assignment}`)).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT invalid_setting');
      }
      await client.query(`UPDATE "${schema}".ai_models SET conversation_api='chat_completions', reasoning_history='none'`);
      await client.query(`UPDATE "${schema}".ai_models SET conversation_api='responses', reasoning_history='auto', reasoning_summary='detailed'`);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await close();
    }
  });
});
