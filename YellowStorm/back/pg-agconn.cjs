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
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_connectors' ORDER BY ordinal_position");
  console.log('agent_connectors cols:', cols.rows.map((r) => r.column_name).join(', '));
  const c = await pool.query('SELECT * FROM agent_connectors WHERE agent_id = $1', ['6a9adf730ca4edec140be1e7']);
  console.log('executor connectors:', JSON.stringify(c.rows, null, 1));
  const cj = await pool.query('SELECT * FROM agent_connectors WHERE agent_id = $1', ['6aaa6911d39ef132188aec00']);
  console.log('judge connectors:', JSON.stringify(cj.rows, null, 1));
  const kb = await pool.query('SELECT * FROM agent_knowledge_bases WHERE agent_id = $1', ['6a9adf730ca4edec140be1e7']);
  console.log('executor knowledge_bases cols/rows:', kb.rows);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });