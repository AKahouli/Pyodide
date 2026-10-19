import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describeIntegration, makeTestDb } from './testing/pg-integration';

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };

describeIntegration('migration history repair on disposable loopback databases', () => {
  const folder = path.resolve(__dirname, '..', '..', '..', 'drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Entry[]; version: string; dialect: string;
  };
  let admin: Pool;
  let pool: Pool;
  let database: string;
  let scratch: string;

  beforeAll(() => {
    if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.POSTGRES_HOST ?? '')) {
      throw new Error('Migration-history verification requires disposable loopback PostgreSQL');
    }
    admin = makeTestDb().pool;
  });

  beforeEach(async () => {
    database = `ys_migration_history_${randomBytes(8).toString('hex')}`;
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-migration-history-'));
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database,
      max: 1,
      options: '-c lock_timeout=5s',
    });
  }, 60_000);

  afterEach(async () => {
    if (pool) await pool.end();
    if (database) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  afterAll(async () => { if (admin) await admin.end(); });

  function historicalFolder(through?: string): string {
    // Reproduce the old registration, including its timestamp collision, rather
    // than pretending every deployed database has a corrected ledger.
    const entries = journal.entries.filter((entry) => entry.tag !== '0045_yellowmind_graph_walks');
    const graph = journal.entries.find((entry) => entry.tag === '0045_yellowmind_graph_walks')!;
    entries.splice(54, 0, { ...graph, idx: 46, when: 1792200000000 });
    const selected = through ? entries.slice(0, entries.findIndex((entry) => entry.tag === through) + 1) : entries;
    fs.mkdirSync(path.join(scratch, 'meta'));
    fs.writeFileSync(path.join(scratch, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: selected }));
    for (const entry of selected) {
      fs.copyFileSync(path.join(folder, `${entry.tag}.sql`), path.join(scratch, `${entry.tag}.sql`));
    }
    return scratch;
  }

  async function ledger(): Promise<Array<{ hash: string; created_at: string }>> {
    return (await pool.query<{ hash: string; created_at: string }>(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    )).rows;
  }

  it('installs fresh and repeats without replaying any SQL', async () => {
    expect((await pool.query('SHOW lock_timeout')).rows[0].lock_timeout).toBe('5s');
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const first = await ledger();
    expect(first).toHaveLength(journal.entries.length);
    expect(first.at(-1)?.created_at).toBe('1792454400004');
    await migrate(drizzle(pool), { migrationsFolder: folder });
    expect(await ledger()).toEqual(first);
  }, 120_000);

  it.each([undefined, '0050_model_conversation_api'])(
    'upgrades historical watermark %s without replaying non-idempotent DDL',
    async (through) => {
      await migrate(drizzle(pool), { migrationsFolder: historicalFolder(through) });
      const previous = await ledger();
      await pool.query(`INSERT INTO catalog.agent_types (id, name, slug)
        VALUES ('bbbbbbbbbbbbbbbbbbbbbbbb', 'History fixture', 'platform_copilot')`);
      await pool.query(`INSERT INTO agents
        (id, name, role, agent_type_id, created_by, slug, agent_type_slug, is_default, instruction)
        VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa', 'History fixture', 'assistant',
          'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc',
          'platform-copilot', 'platform_copilot', true, '[Semantic model chat] and give the total.')`);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const upgraded = await ledger();
      expect(upgraded.slice(0, previous.length)).toEqual(previous);
      expect(upgraded.filter((entry) => entry.created_at === '1792454400004')).toHaveLength(1);
      const agent = (await pool.query('SELECT instruction, updated_at FROM agents WHERE id = $1',
        ['aaaaaaaaaaaaaaaaaaaaaaaa'])).rows[0];
      expect(agent.instruction.match(/For a question across several links/g)).toHaveLength(1);
      expect((await pool.query(`SELECT conversation_api, responses_history_mode FROM catalog.ai_models LIMIT 0`)).fields
        .map((field) => field.name)).toEqual(['conversation_api', 'responses_history_mode']);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(await ledger()).toEqual(upgraded);
      expect((await pool.query('SELECT instruction, updated_at FROM agents WHERE id = $1',
        ['aaaaaaaaaaaaaaaaaaaaaaaa'])).rows[0]).toEqual(agent);
    }, 120_000,
  );
});
