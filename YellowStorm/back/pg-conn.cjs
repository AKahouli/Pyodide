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
  const ts = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%connector%' OR table_name ILIKE '%mcp%') ORDER BY table_name");
  console.log('connector tables:', ts.rows.map((r) => r.table_name).join(', '));
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='connectors'");
  if (cols.rows.length) {
    console.log('connectors cols:', cols.rows.map((r) => r.column_name).join(', '));
    const c = await pool.query('SELECT * FROM connectors WHERE id = $1', ['6a8ee76d4db4ebc5565d11d6']);
    const row = c.rows[0];
    if (row) {
      for (const k of Object.keys(row)) {
        let v = row[k];
        if (typeof v === 'string' && v.length > 200) v = v.slice(0, 200) + '...';
        console.log(' ', k, '=', JSON.stringify(v));
      }
    } else {
      console.log('connector not found by id — cols:', (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='connectors'")).rows.map(r=>r.column_name).join(','));
      const cc = await pool.query('SELECT * FROM connectors LIMIT 10');
      console.log('sample connectors:', cc.rows);
    }
  } else {
    console.log('no connectors table');
  }
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });