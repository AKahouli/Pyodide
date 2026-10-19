/** Read-only R03 inventory. Never emits field contents, URL values or errors. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

export function summarizeRecord(recordType, row) {
  const findings = [];
  const endpoint = row.mcp_server_url;
  const knownValues = [];
  try {
    const parsed = new URL(endpoint);
    knownValues.push(parsed.password, ...parsed.searchParams.values(), parsed.hash.slice(1));
  } catch { /* malformed URLs are inventoried below, never printed */ }
  for (const [field, value] of Object.entries(row)) {
    if (field === 'id') continue;
    let queryUrlCount = 0;
    let userinfoUrlCount = 0;
    let invalidUrlCount = 0;
    let copiedValueCount = 0;
    const names = new Set();
    for (const text of strings(value)) {
      if (field !== 'mcp_server_url' && knownValues.some(secret => secret && text.includes(secret))) copiedValueCount++;
      const urls = field === 'mcp_server_url' ? [text] : (text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []);
      for (const url of urls) {
        try {
          const parsed = new URL(url);
          if (parsed.username || parsed.password) userinfoUrlCount++;
          if (url.includes('?')) {
            queryUrlCount++;
            for (const name of parsed.searchParams.keys()) {
              // Names only; unusual binary/unbounded names are not printed.
              names.add(/^[a-z][a-z0-9_.-]{0,63}$/i.test(name) ? name : '[unusual-name]');
            }
          }
        } catch { invalidUrlCount++; }
      }
    }
    if (queryUrlCount || userinfoUrlCount || invalidUrlCount || copiedValueCount) findings.push({
      recordType, id: String(row.id), field, queryUrlCount, userinfoUrlCount,
      invalidUrlCount, copiedValueCount, queryParameterNames: [...names].sort(),
    });
  }
  return findings;
}

async function postgresInventory(emit) {
  // Explicit operator invocation only. Uses PG* environment variables; no .env
  // loading, credential printing or default production connection in this script.
  if (!process.env.PGDATABASE || !process.env.PGHOST) throw new Error('configuration required');
  const require = createRequire(new URL('../../YellowStorm/back/package.json', import.meta.url));
  const { Client } = require('pg');
  const client = new Client();
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const sources = [
      ['connector', 'integrations.connectors', 'id, mcp_server_url, description, auth_config_schema, actions'],
      ['audit', 'authz.audit_logs', 'id, metadata'],
    ];
    for (const [recordType, table, fields] of sources) {
      let cursor = '';
      while (true) {
        const { rows } = await client.query(`SELECT ${fields} FROM ${table} WHERE id > $1 ORDER BY id LIMIT 250`, [cursor]);
        if (!rows.length) break;
        for (const row of rows) for (const finding of summarizeRecord(recordType, row)) emit(finding);
        cursor = rows.at(-1).id;
      }
    }
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}

async function main() {
  if (!process.argv.includes('--dry-run')) throw new Error('explicit dry run required');
  let count = 0;
  const emit = finding => { process.stdout.write(`${JSON.stringify(finding)}\n`); count++; };
  if (process.argv.includes('--postgres')) await postgresInventory(emit);
  else {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const records = JSON.parse(input);
    if (!Array.isArray(records)) throw new Error('record array required');
    for (const { recordType, row } of records) for (const finding of summarizeRecord(recordType, row)) emit(finding);
  }
  process.stdout.write(`${JSON.stringify({ dryRun: true, findingCount: count })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('R03 inventory failed; verify authorized read-only connection/input configuration. No row contents emitted.\n');
    process.exitCode = 1;
  });
}
