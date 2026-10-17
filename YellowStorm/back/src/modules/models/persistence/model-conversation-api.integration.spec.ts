import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';

describeIntegration('model conversation API migration', () => {
  it('defaults existing rows, persists switches and rejects unsupported APIs', async () => {
    const { pool, close } = makeTestDb();
    const client = await pool.connect();
    const schema = `test_model_api_${randomBytes(8).toString('hex')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".ai_models (id text PRIMARY KEY)`);
      await client.query(`INSERT INTO "${schema}".ai_models (id) VALUES ('existing')`);
      const migration = readFileSync(resolve(process.cwd(), 'drizzle/0050_model_conversation_api.sql'), 'utf8');
      await client.query(migration.replaceAll('"catalog"', `"${schema}"`));
      expect((await client.query(`SELECT conversation_api FROM "${schema}".ai_models WHERE id = 'existing'`)).rows[0].conversation_api).toBe('chat_completions');
      await client.query(`UPDATE "${schema}".ai_models SET conversation_api = 'responses' WHERE id = 'existing'`);
      expect((await client.query(`SELECT conversation_api FROM "${schema}".ai_models WHERE id = 'existing'`)).rows[0].conversation_api).toBe('responses');
      await client.query(`INSERT INTO "${schema}".ai_models (id) VALUES ('new')`);
      expect((await client.query(`SELECT conversation_api FROM "${schema}".ai_models WHERE id = 'new'`)).rows[0].conversation_api).toBe('chat_completions');
      await client.query('SAVEPOINT invalid_api');
      await expect(client.query(`UPDATE "${schema}".ai_models SET conversation_api = 'invalid' WHERE id = 'existing'`)).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_api');
      await client.query(`UPDATE "${schema}".ai_models SET conversation_api = 'chat_completions' WHERE id = 'existing'`);
      expect((await client.query(`SELECT conversation_api FROM "${schema}".ai_models WHERE id = 'existing'`)).rows[0].conversation_api).toBe('chat_completions');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await close();
    }
  });
});
