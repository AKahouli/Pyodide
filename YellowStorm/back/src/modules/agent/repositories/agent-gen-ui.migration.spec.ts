import * as fs from 'fs';
import * as path from 'path';
import { newObjectId } from '@common/postgres';
import { agents } from '../../postgres/schema/agents.schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

const migrationPath = path.resolve(process.cwd(), 'drizzle/0048_agent_gen_ui.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

describe('0048_agent_gen_ui migration file', () => {
  it('adds a NOT NULL boolean column defaulting to OFF and switches openui- agents ON, only when it adds the column', () => {
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration).toMatch(/ADD COLUMN gen_ui_enabled boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/UPDATE agents SET gen_ui_enabled = true WHERE left\(slug, 7\) = 'openui-'/);
    // The backfill sits inside the "column missing" guard so a replay never re-enables a disabled agent.
    expect(migration.indexOf('IF NOT EXISTS')).toBeLessThan(migration.indexOf('UPDATE agents'));
  });

  it('matches the Drizzle column (OFF by default, not null)', () => {
    expect(agents.genUiEnabled.name).toBe('gen_ui_enabled');
    expect(agents.genUiEnabled.notNull).toBe(true);
    expect(agents.genUiEnabled.default).toBe(false);
  });
});

/** Runs the real file on pre-migration data inside a rolled-back transaction. */
describeIntegration('0048_agent_gen_ui on existing agents (integration)', () => {
  const { pool, close } = makeTestDb();

  afterAll(async () => {
    await close();
  });

  it('keeps existing agents OFF except openui- slugs, and a replay does not re-enable a disabled one', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const typeId = newObjectId();
      await client.query(
        `INSERT INTO catalog.agent_types (id, name, slug, default_prompt) VALUES ($1, $2, $3, '')`,
        [typeId, `gen-ui-${typeId}`, `gen-ui-${typeId}`],
      );
      const insert = (id: string, slug: string) => client.query(
        `INSERT INTO agents (id, name, slug, role, agent_type_id, created_by) VALUES ($1, $2, $3, 'role', $4, $5)`,
        [id, `agent ${id}`, slug, typeId, newObjectId()],
      );
      const [openUi, plain, lookalike] = [newObjectId(), newObjectId(), newObjectId()];
      await client.query('ALTER TABLE agents DROP COLUMN IF EXISTS gen_ui_enabled');
      await insert(openUi, `openui-${openUi}`);
      await insert(plain, `plain-${plain}`);
      await insert(lookalike, `my-openui-${lookalike}`);

      await client.query(migration);

      const flags = async () => Object.fromEntries((await client.query<{ id: string; gen_ui_enabled: boolean }>(
        'SELECT id, gen_ui_enabled FROM agents WHERE id = ANY($1::char(24)[])', [[openUi, plain, lookalike]],
      )).rows.map((row) => [row.id.trim(), row.gen_ui_enabled]));
      expect(await flags()).toEqual({ [openUi]: true, [plain]: false, [lookalike]: false });

      // Replay after an admin switched the openui- agent off: nothing is touched.
      await client.query('UPDATE agents SET gen_ui_enabled = false WHERE id = $1', [openUi]);
      await client.query(migration);
      expect((await flags())[openUi]).toBe(false);

      // A row inserted without the column (raw insert, system bootstrap) is OFF.
      const raw = newObjectId();
      await insert(raw, `raw-${raw}`);
      expect((await client.query<{ gen_ui_enabled: boolean }>('SELECT gen_ui_enabled FROM agents WHERE id = $1', [raw])).rows[0].gen_ui_enabled).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
