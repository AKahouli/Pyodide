import { readFileSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { effectiveMemorySettings as effective } from './memory-settings.mjs';

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

// Status requests reuse the host MCP connection; no extra graph process or rebuild.
export async function probeStartup({ root, client, checkpointError, readConfig = config, request = fetch }) {
  const result = { root, checkedAt: new Date().toISOString(), checkpoints: checkpointError ? fail('Checkpoint store unavailable.', 'Repair the current root policy/Git/store; retry sdlc_health.') : pending('Verifying local SQLite persistence.', 'Run sdlc_health.'), graph: pending('Scoped graph query not yet verified.', `Call code-review-graph_list_graph_stats_tool with repo_root=${root}.`), hindsight: pending('Current memory workspace/bank not yet verified.', 'Call hindsight_diagnose; the harness will verify its bank API.') };
  await Promise.all([
    (async () => {
      if (!client?.tool?.ids) return; // Pending native probes still establish actual tool availability.
      try {
        const ids = await client.tool.ids({ directory: root, query: { directory: root } }, { signal: AbortSignal.timeout(10000) });
        if (ids.error || !Array.isArray(ids.data)) throw new Error('registry');
        if (!ids.data.includes('hindsight_diagnose')) result.hindsight = fail('Hindsight native tools are absent in this process/directory.', 'Enable the Hindsight plugin and current-directory opt-in, restart OpenCode, then retry sdlc_health.');
      } catch { result.hindsight = fail('Native memory tool registry check failed.', 'Inspect plugin loading and restart OpenCode before retrying sdlc_health.'); }
    })(),
    (async () => {
      try {
        const state = await client.mcp.status({ directory: root, query: { directory: root } }, { signal: AbortSignal.timeout(10000) });
        if (state.error || state.data?.['code-review-graph']?.status !== 'connected') result.graph = fail('Code Review Graph MCP is not connected.', 'Reconnect the graph MCP in this OpenCode process, then retry sdlc_health.');
      } catch { result.graph = fail('Graph connection check failed or timed out.', 'Check OpenCode MCP status, then retry sdlc_health.'); }
    })(),
    (async () => {
      try {
        const cfg = effective(readConfig(), root);
        if (cfg.disabled || cfg.retainSessions === false || process.env.HINDSIGHT_DISABLE_HOOKS) throw new Error('disabled');
        const url = cfg.apiUrl;
        if (!url) throw new Error('endpoint');
        const health = await json(new URL('health', url.replace(/\/?$/, '/')), cfg.apiToken, request);
        if (health.status !== 'healthy' || health.database !== 'connected') throw new Error('unhealthy');
        // Opt-in and bank mapping are established by the actual plugin's diagnose tool.
      } catch { result.hindsight = fail('Hindsight configuration, capture setting or API health check failed.', 'Check current-directory opt-in and Hindsight daemon/configuration; restart the host after config changes and retry sdlc_health.'); }
    })(),
  ]);
  return result;
}

export async function verifyObservation({ root, tool, args, output, readConfig = config, request = fetch }) {
  if (/code.review.graph.*list_graph_stats_tool$/.test(tool)) {
    try {
      if (!args?.repo_root || canonical(args.repo_root) !== canonical(root)) throw new Error('root');
      const data = response(output);
      if (!data || data.status !== 'ok' || data.error) throw new Error('response');
      if (/list_graph_stats_tool$/.test(tool) && !(data.total_nodes > 0)) throw new Error('index');
      // An empty/missing index cannot provide code context even if MCP is connected.
      if (data.total_nodes === 0 || data.node_count === 0 || data.status === 'not_initialized' || /(?:not built|not initialized|no graph|graph.*not found)/i.test(JSON.stringify(data))) throw new Error('index');
      return { key: 'graph', value: { status: 'PASS', reason: 'Scoped graph tool completed in the current root.', root } };
    } catch { return { key: 'graph', value: fail('Graph query failed, returned no usable index, or targeted another root.', `Inspect/build the graph for ${root}, then rerun the scoped graph check.`) }; }
  }
  if (tool === 'hindsight_diagnose') {
    try {
      const data = response(output);
      if (canonical(data.workspace) !== canonical(root) || data.config?.disabled || data.credential?.api_token_matches_config === false || data.environment?.hooks_disabled || !data.bank_id) throw new Error('workspace');
      const cfg = effective(readConfig(), root, data.bank_id);
      if (cfg.disabled || cfg.retainSessions === false || process.env.HINDSIGHT_DISABLE_HOOKS) throw new Error('capture disabled');
      response(await json(new URL(`v1/default/banks/${encodeURIComponent(data.bank_id)}/stats`, data.config.api_url.replace(/\/?$/, '/')), cfg.apiToken, request));
      return { key: 'hindsight', value: { status: 'PASS', reason: `Plugin workspace and authenticated bank read verified (${data.bank_id}); capture is configured.`, bank: data.bank_id, root } };
    } catch { return { key: 'hindsight', value: fail('Hindsight workspace, opt-in, credential or bank read verification failed.', 'Fix Hindsight configuration for this directory and restart the host if changed; rerun hindsight_diagnose.') }; }
  }
  return null;
}

export function healthLine(report) {
  return `Session checks (${report.root}): graph ${report.graph.status}; Hindsight ${report.hindsight.status}; checkpoints ${report.checkpoints.status}.`;
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
