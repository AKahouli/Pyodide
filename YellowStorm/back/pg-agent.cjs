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
  const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='agents' ORDER BY ordinal_position");
  console.log('agents cols:', cols.rows.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
  const a = await pool.query('SELECT * FROM agents WHERE id = $1', ['6a9adf730ca4edec140be1e7']);
  const row = a.rows[0];
  for (const c of cols.rows) {
    const k = c.column_name;
    let v = row[k];
    if (['role', 'instruction', 'name', 'description'].includes(k) && typeof v === 'string') v = v.slice(0, 80) + '...';
    if (typeof v === 'string' && v.length > 160) v = v.slice(0, 160) + '...';
    console.log(k, '=', JSON.stringify(v));
  }
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });