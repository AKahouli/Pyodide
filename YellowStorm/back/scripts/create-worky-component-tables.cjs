/**
 * Create the worky component tables in the manager's Electric-synced Postgres so
 * the `message_components` / `plan_step_components` shapes can sync. Idempotent.
 *
 * Mirrors the existing worky tables in that DB (companion_ai): `text` ids,
 * `timestamptz default now()`, REPLICA IDENTITY FULL, and membership in the
 * `electric_publication_default` publication. `plan_step_artifacts` already
 * exists there, so it is left untouched.
 *
 * Connection uses the POSTGRES_* creds from back/.env, but targets the manager
 * DB (WORKY_MANAGER_DB, default `companion_ai`) — NOT POSTGRES_DB (agentstore).
 *
 * Usage:  node back/scripts/create-worky-component-tables.cjs
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const { Client } = require('pg');

const PUBLICATION = 'electric_publication_default';
const TABLES = ['message_components', 'plan_step_components'];

const DDL = {
  message_components: `
    CREATE TABLE IF NOT EXISTS public.message_components (
      session_id   text    NOT NULL,
      message_id   text    NOT NULL,
      component_id text    NOT NULL,
      ordinal      integer NOT NULL DEFAULT 0,
      type         text    NOT NULL,
      data         jsonb   NOT NULL DEFAULT '{}'::jsonb,
      created_at   timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, component_id)
    );
    CREATE INDEX IF NOT EXISTS message_components_session_message_idx
      ON public.message_components (session_id, message_id, ordinal);`,
  plan_step_components: `
    CREATE TABLE IF NOT EXISTS public.plan_step_components (
      session_id   text    NOT NULL,
      step_id      text    NOT NULL,
      component_id text    NOT NULL,
      ordinal      integer NOT NULL DEFAULT 0,
      type         text    NOT NULL,
      data         jsonb   NOT NULL DEFAULT '{}'::jsonb,
      created_at   timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, component_id)
    );
    CREATE INDEX IF NOT EXISTS plan_step_components_session_step_idx
      ON public.plan_step_components (session_id, step_id, ordinal);`,
};

(async () => {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.WORKY_MANAGER_DB || 'companion_ai',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  console.log('connected to database:', (await client.query('select current_database() as db')).rows[0].db);

  for (const tbl of TABLES) {
    await client.query(DDL[tbl]);
    console.log(`ensured table + index: ${tbl}`);
    await client.query(`ALTER TABLE public.${tbl} REPLICA IDENTITY FULL;`);
    console.log(`  replica identity FULL set`);

    // Electric auto-adds a table to its publication as soon as it exists and a
    // shape is requested, so this is usually a no-op — attempt it anyway (in case
    // Electric isn't actively polling) and treat "already member" as success.
    try {
      await client.query(`ALTER PUBLICATION ${PUBLICATION} ADD TABLE public.${tbl};`);
      console.log(`  added to publication ${PUBLICATION}`);
    } catch (e) {
      if (/already member/i.test(e.message)) {
        console.log(`  already in publication ${PUBLICATION} (Electric added it)`);
      } else {
        throw e;
      }
    }
  }

  const finalTables = (await client.query(
    `select tablename from pg_tables where schemaname='public' and tablename = any($1::text[]) order by tablename`,
    [['message_components', 'plan_step_components', 'plan_step_artifacts']],
  )).rows.map((r) => r.tablename);
  const finalPub = (await client.query(
    `select tablename from pg_publication_tables where pubname=$1 order by tablename`,
    [PUBLICATION],
  )).rows.map((r) => r.tablename);
  console.log('\nworky component/artifact tables present:', finalTables);
  console.log(`${PUBLICATION} members:`, finalPub);

  await client.end();
  console.log('\nDone.');
})().catch((e) => { console.error('CREATE ERROR:', e.message); process.exit(1); });
