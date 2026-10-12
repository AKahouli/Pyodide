import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openHarness } from '../runtime/lib/sdlc-core.mjs';

const root = process.argv[2];
if (!root) throw new Error('Supply the isolated fixture worktree served on localhost ports 6181 and 6182.');
const model = { providerID: 'openai', modelID: 'gpt-6-luna' };
const request = async (base, url, body) => {
  const result = await fetch(base + url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!result.ok) throw new Error(`${url}: ${result.status} ${(await result.text()).slice(0, 800)}`);
  return result.status === 204 ? null : result.json();
};
async function events(base) {
  const controller = new AbortController();
  const stream = await fetch(base + '/event', { signal: controller.signal });
  const reader = stream.body.getReader();
  const waiting = new Map();
  const pump = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    while (true) {
      const result = await reader.read(); if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
        const raw = JSON.parse(data.slice(6)); const event = raw.payload ?? raw;
        const waiter = waiting.get(event.properties?.sessionID);
        if (event.type === 'session.error' && waiter) waiter.error = JSON.stringify(event.properties.error);
        if (event.type === 'session.idle' && waiter) { waiting.delete(event.properties.sessionID); clearTimeout(waiter.timeout); waiter.error ? waiter.reject(new Error(waiter.error)) : waiter.resolve(); }
      }
    }
  })().catch(error => { if (error.name !== 'AbortError') for (const waiter of waiting.values()) waiter.reject(error); });
  return {
    wait(id) { return new Promise((resolve, reject) => { const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`Timed out waiting for ${id}`)); }, 150000); waiting.set(id, { resolve, reject, timeout }); }); },
    async close() { controller.abort(); await pump; },
  };
}
const bases = ['http://127.0.0.1:6181', 'http://127.0.0.1:6182'];
const streams = await Promise.all(bases.map(events));
let harness;
try {
  let sessions;
  if (process.argv.includes('--resume-only')) {
    harness = await openHarness(root);
    const previous = harness.list('resume-verification-probe');
    sessions = ['Isolation A', 'Isolation B'].map(goal => {
      const task = previous.find(task => task.goal === goal);
      assert.ok(task, `No saved native verification task for ${goal}`);
      return { id: task.id };
    });
  } else sessions = await Promise.all(bases.map((base, index) => request(base, '/session', { title: `SDLC native verification ${index}` })));
  const instructions = index => {
    const file = index ? 'src/b.js' : 'src/a.js'; const symbol = index ? 'other' : 'value'; const marker = index ? 'B' : 'A';
    return `One-phase authorized harness verification in a disposable fixture. Own ONLY ${file}. Do not ask questions, run shell commands, use MCP, or launch specialists. First deliberately attempt a native source edit (ApplyPatch/Edit/Write) changing ${symbol} to ${index ? 202 : 101}, BEFORE checkpoint/Read/prepare: the guard should reject it. Then recover without asking permission: sdlc_checkpoint goal "Isolation ${marker}", acceptance ["${symbol} is ${index ? 202 : 101}"], nextAction "Update existing constant", status active. Read docs/agent-context/README.md, guidelines.md, and ${file}; call sdlc_prepare with that target, both documents, that source, and reuseDecision "Extend the existing constant; no new module". Apply the native edit and read the result. Save completed ["Updated ${file}"], status waiting, nextAction "Report RESUME_${marker} without changing files", checks [{name:"Static constant criterion",status:"PASS",files:["${file}"]}]. Do not mark completed: this test deliberately leaves a resumable task. End with LIVE_${marker}.`;
  };
  if (!process.argv.includes('--resume-only')) {
    const done = sessions.map((session, index) => streams[index].wait(session.id));
    await Promise.all(sessions.map((session, index) => request(bases[index], `/session/${session.id}/prompt_async`, { agent: 'build', model, parts: [{ type: 'text', text: instructions(index) }] })));
    await Promise.all(done);
  }
  const histories = await Promise.all(sessions.map((session, index) => request(bases[index], `/session/${session.id}/message`)));
  for (const [index, history] of histories.entries()) {
    const tools = history.flatMap(message => message.parts).filter(part => part.type === 'tool');
    assert.ok(tools.some(part => ['edit', 'write', 'apply_patch'].includes(part.tool) && part.state.status === 'error' && /sdlc_prepare|Before editing/i.test(part.state.error)), JSON.stringify(tools.map(part => ({ tool: part.tool, status: part.state.status, error: part.state.error }))));
    assert.ok(tools.some(part => part.tool === 'sdlc_prepare' && part.state.status === 'completed'));
    assert.ok(tools.some(part => ['edit', 'write', 'apply_patch'].includes(part.tool) && part.state.status === 'completed'));
    assert.match(readFileSync(path.join(root, index ? 'src/b.js' : 'src/a.js'), 'utf8'), index ? /202/ : /101/);
  }
  harness ??= await openHarness(root);
  const before = harness.state(sessions[0].id);
  assert.equal(before.goal, 'Isolation A');
  const fresh = await request(bases[1], '/session', { title: 'SDLC automatic resume verification' });
  await request(bases[1], `/session/${fresh.id}/message`, { agent: 'build', model, noReply: true, parts: [{ type: 'text', text: `resume task ${sessions[0].id}` }] });
  const resumed = harness.state(fresh.id);
  assert.equal(resumed.id, sessions[0].id);
  assert.equal(resumed.sessionID, fresh.id);
  assert.equal(resumed.goal, before.goal);
  assert.equal(resumed.nextAction, before.nextAction);
  assert.deepEqual(resumed.prepared, {});
  const resumedDone = streams[1].wait(fresh.id);
  await request(bases[1], `/session/${fresh.id}/prompt_async`, { agent: 'build', model, parts: [{ type: 'text', text: 'Read your automatically injected checkpoint. Report its goal and recorded nextAction. Do not change files or call tools.' }] });
  await resumedDone;
  const final = await request(bases[1], `/session/${fresh.id}/message`);
  const text = final.filter(message => message.info.role === 'assistant').flatMap(message => message.parts).filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.match(text, /Isolation A/); assert.match(text, /RESUME_A/);
  console.log(JSON.stringify({ parallelOpenCodeServers: 2, guardRejectsUnpreparedNativeEdits: true, validReuseAllowsEdits: true, independentTaskState: true, automaticResumeTransferredTask: true, resumedModelReceivesNextAction: true }));
} finally {
  harness?.close();
  await Promise.all(streams.map(stream => stream.close()));
}
