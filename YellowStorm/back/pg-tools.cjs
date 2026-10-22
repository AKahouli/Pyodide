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
const cols = (t) => pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]).then((r) => r.rows.map((x) => x.column_name));

(async () => {
  console.log('agent_tools cols:', (await cols('agent_tools')).join(', '));
  console.log('tools? table:');
  const ts = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('tools','agent_tool')");
  console.log(ts.rows);
  const at = await pool.query('SELECT * FROM agent_tools WHERE agent_id = $1 LIMIT 20', ['6a9adf730ca4edec140be1e7']);
  console.log('executor agent_tools:', JSON.stringify(at.rows, null, 1));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });