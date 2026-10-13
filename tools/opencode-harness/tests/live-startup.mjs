import assert from 'node:assert/strict';
import path from 'node:path';
import { openHarness } from '../runtime/lib/sdlc-core.mjs';

const root = process.argv[2];
if (!root) throw new Error('Supply the real opted-in worktree served on localhost ports 6193 and 6194. The graph and Hindsight daemon must be available.');
const request = async (base, route, body) => {
  const response = await fetch(base + route, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150000) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const sessions = await Promise.all([6193, 6194].map(async port => {
  const base = `http://127.0.0.1:${port}`;
  const session = await request(base, '/session', { title: 'SDLC startup verification' });
  await request(base, `/session/${session.id}/message`, { model: { providerID: 'openai', modelID: 'gpt-6-luna' }, agent: 'build', parts: [{ type: 'text', text: `Verify integration startup only; no edits or unrelated tools. Run code-review-graph_list_graph_stats_tool with repo_root=${path.resolve(root)} and hindsight_diagnose first. After both finish, read sdlc_health with no refresh. If PENDING, read health again after completed probes; do not refresh (it discards their evidence). Report actual statuses and recovery if needed.` }] });
  const messages = await request(base, `/session/${session.id}/message`);
  const tools = messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool');
  for (const expected of ['code-review-graph_list_graph_stats_tool', 'hindsight_diagnose', 'sdlc_health']) assert.ok(tools.some(part => part.tool === expected && part.state?.status === 'completed'), `${session.id}: ${expected} did not complete`);
  const health = tools.filter(part => part.tool === 'sdlc_health').at(-1);
  const report = JSON.parse(health.state.output);
  for (const name of ['graph', 'hindsight', 'checkpoints']) assert.equal(report[name].status, 'PASS', `${session.id}: ${name}: ${report[name].reason}`);
  assert.equal(path.resolve(report.root).toLowerCase(), path.resolve(root).toLowerCase());
  return { sessionID: session.id, processID: report.processID, root: report.root };
}));
assert.notEqual(sessions[0].sessionID, sessions[1].sessionID);
assert.notEqual(sessions[0].processID, sessions[1].processID);
const harness = await openHarness(root);
try {
  for (const session of sessions) {
    const task = harness.state(session.sessionID);
    const receipt = task.startupHealth[session.sessionID];
    assert.equal(receipt.processID, session.processID);
    assert.equal(receipt.graph.status, 'PASS'); assert.equal(receipt.hindsight.status, 'PASS');
  }
} finally { harness.close(); }
console.log(JSON.stringify({ parallelProcesses: 2, scopedNativeGraph: 'PASS', actualMemoryBankRead: 'PASS', checkpointWriteRead: 'PASS', independentReceipts: 'PASS', sessions }));
