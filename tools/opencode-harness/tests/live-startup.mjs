import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.argv[2];
if (!root) throw new Error('Supply the real opted-in worktree served on localhost ports 6193 and 6194. The graph and Hindsight daemon must be available.');
const request = async (base, route, body) => {
  const response = await fetch(base + route, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const started = performance.now();
const db = new DatabaseSync(path.join(root, '.opencode/sdlc/checkpoints.sqlite'), { readOnly: true });
const receipt = sid => {
  // Query existing storage directly: never create a task/receipt while verifying it.
  const row = db.prepare('SELECT tasks.data FROM sessions JOIN tasks ON tasks.id=sessions.task WHERE sessions.id=?').get(sid);
  return row ? JSON.parse(row.data).startupHealth?.[sid] : null;
};
let sessions;
try {
  sessions = await Promise.all([6193, 6194].map(async port => {
    const base = `http://127.0.0.1:${port}`;
    const session = await request(base, '/session', { title: 'Automatic SDLC startup verification' });
    await request(base, `/session/${session.id}/message`, { noReply: true, parts: [{ type: 'text', text: 'Start an ordinary documentation task. Do not edit any files.' }] });
    let report;
    const deadline = performance.now() + 30000;
    while (!(report = receipt(session.id)) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(report, `${session.id}: startup did not persist an existing receipt`);
    for (const name of ['graph', 'hindsight', 'checkpoints']) assert.equal(report[name].status, 'PASS', `${session.id}: ${name}: ${report[name].reason}`);
    assert.equal(path.resolve(report.root).toLowerCase(), path.resolve(root).toLowerCase());
    const messages = await request(base, `/session/${session.id}/message`);
    const tools = messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool');
    assert.equal(tools.length, 0, `${session.id}: automatic startup should not require model tool calls`);
    return { sessionID: session.id, processID: report.processID, root: report.root, probe: report.probe, harnessVersion: report.harnessVersion };
  }));
  assert.notEqual(sessions[0].sessionID, sessions[1].sessionID);
  assert.notEqual(sessions[0].processID, sessions[1].processID);
  assert.notEqual(sessions[0].probe, sessions[1].probe);
  for (const session of sessions) assert.equal(receipt(session.sessionID).processID, session.processID);
} finally { db.close(); }
console.log(JSON.stringify({ parallelProcesses: 2, scopedGraphIndexAndTransport: 'PASS', actualMemoryBankRead: 'PASS', checkpointWriteRead: 'PASS', independentReceipts: 'PASS', diagnosticModelToolCalls: 0, elapsedMs: Math.round(performance.now() - started), sessions }));
