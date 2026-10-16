const fs = require('fs');
const { Pool } = require('pg');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const pool = new Pool({
  host: env.POSTGRES_HOST, port: +env.POSTGRES_PORT, user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DATABASE || 'agentstore',
});
(async () => {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%agent%' OR table_name ILIKE '%tool%') ORDER BY table_name");
  console.log('candidate tables:', tables.rows.map((r) => r.table_name).join(', '));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });