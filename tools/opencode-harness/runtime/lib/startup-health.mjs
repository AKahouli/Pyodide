import { readFileSync, realpathSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import path from 'node:path';

const fail = (reason, action) => ({ status: 'FAIL', reason, action });
const pending = (reason, action) => ({ status: 'PENDING', reason, action });
export const canonical = value => {
  const result = realpathSync(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? result.toLowerCase() : result;
};

// Bounded head read: graph metadata and the first nodes sit at the start of
// graph.json, so availability never requires loading the whole corpus.
const HEAD_BYTES = 262144;
export async function probeGraphifyIndex(root) {
  const rootMarker = path.join(root, 'graphify-out/.graphify_root');
  const graphFile = path.join(root, 'graphify-out/graph.json');
  const indexRoot = readFileSync(rootMarker, 'utf8').trim();
  let fd;
  try {
    fd = openSync(graphFile, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, HEAD_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, 0);
    const head = buffer.toString('utf8');
    let parsed;
    try { parsed = JSON.parse(head); } catch { parsed = null; }
    let schema = parsed?.graph?.schema_version;
    if (!Number.isInteger(schema)) {
      const metadata = /"graph"\s*:\s*(\{[^{}]*\})/.exec(head)?.[1];
      try { schema = JSON.parse(metadata)?.schema_version; } catch { schema = undefined; }
    }
    if (!Number.isInteger(schema)) throw new Error('schema');
    const nodesStart = head.indexOf('"nodes"');
    if (nodesStart < 0) throw new Error('nodes');
    if (!/\[\s*\{/.test(head.slice(nodesStart, nodesStart + 64))) throw new Error('index');
    return { indexRoot, schemaVersion: schema, graphifyVersion: parsed?.graph?.graphify_version, hasNodes: true };
  } finally { if (fd !== undefined) closeSync(fd); }
}

// Availability only: the graphify git hooks (post-commit/post-checkout) and an
// explicit `graphify update .` after pull/merge own working-tree freshness.
export async function probeStartup({ root, checkpointError, readGraph = probeGraphifyIndex }) {
  const result = { root, checkedAt: new Date().toISOString(), checkpoints: checkpointError ? fail('Checkpoint store unavailable.', 'Repair the current root policy/Git/store; retry sdlc_health.') : pending('Verifying local SQLite persistence.', 'Run sdlc_health.'), graph: pending('Checking the current graph index.', 'Retry sdlc_health.') };
  await (async () => {
    try {
      const graph = await readGraph(root).catch(error => { throw new Error(`index read ${String(error.code || error.name || 'error').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50)}`); });
      if (!graph.indexRoot || canonical(graph.indexRoot) !== canonical(root)) throw new Error('root');
      if (!Number.isInteger(graph.schemaVersion)) throw new Error('schema');
      if (!graph.hasNodes) throw new Error('index');
      result.graph = { status: 'PASS', reason: 'Nonempty current-root graphify index verified.', root };
    } catch (error) { result.graph = fail(`Graph startup verification failed (${['root', 'schema', 'index'].includes(error.message) || /^index read [a-zA-Z0-9_]+$/.test(error.message) ? error.message : String(error.name || 'connection error').replace(/[^a-zA-Z0-9_ ]/g, '').slice(0, 50)}).`, `Inspect the graphify index for ${root}; recover the reported failure, then retry sdlc_health(refresh:true). Run 'graphify extract <root> --code-only' only when graphify-out is missing or empty; after pulls/merges run 'graphify update .'`); }
  })();
  return result;
}

export function healthLine(report) {
  return `Session checks (${report.root}${report.harnessVersion ? `; harness ${report.harnessVersion}` : ''}): graph ${report.graph.status}; checkpoints ${report.checkpoints.status}.`;
}
