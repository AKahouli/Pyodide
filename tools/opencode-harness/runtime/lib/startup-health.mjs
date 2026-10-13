import { readFileSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { effectiveMemorySettings as effective, resolveMemoryTarget } from './memory-settings.mjs';

const fail = (reason, action) => ({ status: 'FAIL', reason, action });
const pending = (reason, action) => ({ status: 'PENDING', reason, action });
export const canonical = value => {
  const result = realpathSync(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? result.toLowerCase() : result;
};
const config = () => JSON.parse(readFileSync(process.env.HINDSIGHT_CONFIG || path.join(homedir(), '.hindsight/coding-agent.json'), 'utf8').replace(/^\uFEFF/, ''));
const response = output => {
  const parsed = typeof output === 'string' ? JSON.parse(output) : output;
  if (parsed?.error || parsed?.isError) throw new Error('Integration returned an error; inspect the bounded tool error and retry.');
  if (parsed?.structuredContent) return response(parsed.structuredContent);
  if (Array.isArray(parsed?.content)) return response(parsed.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));
  if (typeof parsed?.output === 'string') return response(parsed.output);
  return parsed;
};
async function json(url, token, request = fetch) {
  const result = await request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(8000) });
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return result.json();
}

export async function probeGraphIndex(root) {
  const filename = path.join(root, '.code-review-graph/graph.db');
  let db;
  try {
    if (process.versions.bun) {
      const { Database } = await import('bun:sqlite');
      db = new Database(filename, { readonly: true });
    } else {
      const { DatabaseSync } = await import('node:sqlite');
      db = new DatabaseSync(filename, { readOnly: true });
    }
    const query = sql => (db.prepare ? db.prepare(sql) : db.query(sql));
    query('PRAGMA busy_timeout = 2000').run();
    return { repoRoot: query("SELECT value FROM metadata WHERE key = 'repo_root'").get()?.value, hasNodes: Boolean(query('SELECT 1 FROM nodes LIMIT 1').get()) };
  } finally { db?.close(); }
}

// Reuse the host connection and read only one graph row; no rebuild or full count.
export async function probeStartup({ root, hostDirectory = root, memoryDirectory = root, client, checkpointError, readConfig = config, request = fetch, readGraph = probeGraphIndex }) {
  const result = { root, checkedAt: new Date().toISOString(), checkpoints: checkpointError ? fail('Checkpoint store unavailable.', 'Repair the current root policy/Git/store; retry sdlc_health.') : pending('Verifying local SQLite persistence.', 'Run sdlc_health.'), graph: pending('Checking the current graph index.', 'Retry sdlc_health.'), hindsight: pending('Checking the current memory bank.', 'Retry sdlc_health.') };
  const registry = async () => {
    if (!client?.tool?.ids) throw new Error('registry');
    const ids = await client.tool.ids({ directory: hostDirectory, query: { directory: hostDirectory } }, { signal: AbortSignal.timeout(10000) });
    if (ids.error || !Array.isArray(ids.data)) throw new Error('registry');
    return ids.data;
  };
  await Promise.all([
    (async () => {
      try {
        const [state, graph] = await Promise.all([
          client.mcp.status({ directory: hostDirectory, query: { directory: hostDirectory } }, { signal: AbortSignal.timeout(10000) }), readGraph(root).catch(error => { throw new Error(`index read ${String(error.code || error.name || 'error').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50)}`); }),
        ]);
        if (state.error || state.data?.['code-review-graph']?.status !== 'connected') throw new Error('connection');
        if (!graph.repoRoot || canonical(graph.repoRoot) !== canonical(root)) throw new Error('root');
        if (!graph.hasNodes) throw new Error('index');
        result.graph = { status: 'PASS', reason: 'Connected graph tool and nonempty current-root index verified.', root };
      } catch (error) { result.graph = fail(`Graph startup verification failed (${['connection', 'root', 'index'].includes(error.message) || /^index read [a-zA-Z0-9_]+$/.test(error.message) ? error.message : String(error.name || 'connection error').replace(/[^a-zA-Z0-9_ ]/g, '').slice(0, 50)}).`, `Inspect this process's MCP connection and the graph index for ${root}; recover the reported failure, then retry sdlc_health(refresh:true). Rebuild only if the index is missing or empty.`); }
    })(),
    (async () => {
      try {
        const { cfg, bankId } = resolveMemoryTarget(readConfig(), memoryDirectory);
        if (cfg.disabled || cfg.retainSessions === false || process.env.HINDSIGHT_DISABLE_HOOKS) throw new Error('disabled');
        const ids = await registry();
        if (!ids.includes('hindsight_diagnose')) throw new Error('tool');
        const url = cfg.apiUrl;
        if (!url) throw new Error('endpoint');
        const base = url.replace(/\/?$/, '/');
        const [health, bank] = await Promise.all([
          json(new URL('health', base), cfg.apiToken, request),
          json(new URL(`v1/default/banks/${encodeURIComponent(bankId)}/stats`, base), cfg.apiToken, request),
        ]);
        if (health.status !== 'healthy' || health.database !== 'connected') throw new Error('unhealthy');
        response(bank);
        result.hindsight = { status: 'PASS', reason: 'Native memory tool, current-directory configuration and authenticated bank read verified; capture configured.', bank: bankId, root, workspace: memoryDirectory };
      } catch (error) { result.hindsight = fail(`Hindsight startup verification failed (${['disabled', 'tool', 'endpoint', 'unhealthy', 'registry'].includes(error.message) ? error.message : 'configuration/API unavailable'}).`, 'Check current-directory opt-in, bank access and Hindsight daemon/configuration; restart the host after config changes and retry sdlc_health.'); }
    })(),
  ]);
  return result;
}

export async function verifyObservation({ root, memoryDirectory = root, tool, args, output, readConfig = config, request = fetch }) {
  if (/code.review.graph.*list_graph_stats_tool$/.test(tool)) {
    try {
      if (!args?.repo_root || canonical(args.repo_root) !== canonical(root)) throw new Error('root');
      const data = response(output);
      if (!data || data.status !== 'ok' || data.error) throw new Error('response');
      if (/list_graph_stats_tool$/.test(tool) && !(data.total_nodes > 0)) throw new Error('index');
      // An empty/missing index cannot provide code context even if MCP is connected.
      if (data.total_nodes === 0 || data.node_count === 0 || data.status === 'not_initialized') throw new Error('index');
      return { key: 'graph', value: { status: 'PASS', reason: 'Scoped graph tool completed in the current root.', root } };
    } catch (error) { return { key: 'graph', value: fail(`Graph verification failed (${['root', 'response', 'index'].includes(error.message) ? error.message : 'parse/tool error'}).`, `Inspect the scoped graph response for ${root}, recover the integration, then retry sdlc_health(refresh:true).`) }; }
  }
  if (tool === 'hindsight_diagnose') {
    try {
      const data = response(output);
      if (canonical(data.workspace) !== canonical(memoryDirectory) || data.config?.disabled || data.credential?.api_token_matches_config === false || data.environment?.hooks_disabled || !data.bank_id) throw new Error('workspace');
      const cfg = effective(readConfig(), memoryDirectory, data.bank_id);
      if (cfg.disabled || cfg.retainSessions === false || process.env.HINDSIGHT_DISABLE_HOOKS) throw new Error('capture disabled');
      response(await json(new URL(`v1/default/banks/${encodeURIComponent(data.bank_id)}/stats`, data.config.api_url.replace(/\/?$/, '/')), cfg.apiToken, request));
      return { key: 'hindsight', value: { status: 'PASS', reason: `Plugin workspace and authenticated bank read verified (${data.bank_id}); capture is configured.`, bank: data.bank_id, root } };
    } catch { return { key: 'hindsight', value: fail('Hindsight workspace, opt-in, credential or bank read verification failed.', 'Fix Hindsight configuration for this directory and restart the host if changed; rerun hindsight_diagnose.') }; }
  }
  return null;
}

export function healthLine(report) {
  return `Session checks (${report.root}${report.harnessVersion ? `; harness ${report.harnessVersion}` : ''}): graph ${report.graph.status}; Hindsight ${report.hindsight.status}; checkpoints ${report.checkpoints.status}.`;
}

// Hindsight emits session-tagged write-back failures asynchronously. Never
// attribute a bank-only/shared-log event to a specific parallel session.
export function captureFailure(sessionID, since, filename = process.env.HINDSIGHT_DIAG_FILE || path.join(homedir(), '.hindsight/coding-agents-logs/diag.jsonl')) {
  let fd;
  try {
    fd = openSync(filename, 'r');
    const size = statSync(filename).size, start = Math.max(0, size - 65536);
    const buffer = Buffer.alloc(size - start); readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start) lines.shift();
    const relevant = lines.flatMap(line => { try { const item = JSON.parse(line); return item.session === sessionID && item.ts >= since && ['retain_ok', 'retain_failed', 'idle_fetch_failed'].includes(item.event) ? [item] : []; } catch { return []; } });
    const last = relevant.at(-1);
    return last && last.event !== 'retain_ok' ? fail('Hindsight automatic transcript capture failed for this session.', 'Inspect the Hindsight session diagnostic, recover the daemon/credentials, retry startup checks, and verify the next retain result.') : null;
  } catch { return null; } // No log is not positive evidence; startup still requires real native probes.
  finally { if (fd !== undefined) closeSync(fd); }
}
