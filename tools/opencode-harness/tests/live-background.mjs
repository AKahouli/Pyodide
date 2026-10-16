import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fixture } from './fixture.mjs';

// Run against an owned, non-pure localhost OpenCode server in a disposable
// harness fixture. --create-fixture writes its probe agents and prints setup;
// inherited provider credentials stay private. Requires installed SDLC plugin.
if (process.argv.includes('--create-fixture')) {
  const disposable = fixture();
  writeFileSync(path.join(disposable.root, 'AGENTS.md'), readFileSync(new URL('../../../AGENTS.md', import.meta.url)));
  writeFileSync(path.join(disposable.root, 'opencode.json'), JSON.stringify({
    plugin: [],
    agent: {
      'background-probe': { mode: 'primary', model: 'openai/gpt-6-luna', prompt: 'Acceptance coordinator. Follow the exact test directions. Use task and sdlc_checkpoint only; never edit files. Acknowledge internal completion briefly.', permission: { '*': 'deny', task: 'allow', sdlc_checkpoint: 'allow' } },
      'background-child': { mode: 'subagent', model: 'openai/gpt-6-luna', prompt: 'Execute the supplied bounded read-only wait once with bash, then return CHILD_DONE. Do not call other tools.', permission: { '*': 'deny', bash: 'allow' } },
    },
    mcp: Object.fromEntries(['code-review-graph', 'chrome-devtools', 'context7'].map(name => [name, { enabled: false }])),
  }, null, 2));
  console.log(`Disposable fixture: ${disposable.root}\nIn an owned PowerShell terminal:\n$env:OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS = '1'\nSet-Location -LiteralPath '${disposable.root}'\nopencode serve --hostname 127.0.0.1 --port 6207\nIn another terminal from the source repository:\nnode tools/opencode-harness/tests/live-background.mjs "${disposable.root}" http://127.0.0.1:6207\nStop only this test server afterwards with Ctrl+C. Retain the fixture for evidence or remove this exact temporary directory after inspection.`);
  process.exit(0);
}
const root = process.argv[2];
const base = process.argv[3] ?? 'http://127.0.0.1:6207';
if (!root) throw new Error('Supply the disposable fixture root and optional localhost server URL.');
const address = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'Use an owned localhost test server.');
const request = async (route, body) => {
  const response = await fetch(base + route, {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const health = await request('/global/health');
const session = await request('/session', { title: 'SDLC background responsiveness acceptance' });
const controller = new AbortController();
const stream = await fetch(base + '/event', { signal: controller.signal });
const reader = stream.body.getReader();
const timeout = setTimeout(() => controller.abort(new Error('Background acceptance exceeded 180 seconds.')), 180000);
let db, childID, secondSent = false, firstCheckpoint, secondCheckpoint, finished = false;
const checkpoint = () => {
  db ??= new DatabaseSync(path.join(root, '.opencode/sdlc/checkpoints.sqlite'), { readOnly: true });
  const row = db.prepare('SELECT tasks.data FROM sessions JOIN tasks ON tasks.id=sessions.task WHERE sessions.id=?').get(session.id);
  assert.ok(row, 'Parent checkpoint must exist.');
  return JSON.parse(row.data);
};
const send = text => request(`/session/${session.id}/prompt_async`, {
  agent: 'background-probe', model: { providerID: 'openai', modelID: 'gpt-6-luna' }, parts: [{ type: 'text', text }],
});
try {
  await send('Disposable harness acceptance, fully authorized, no file edits. First call sdlc_checkpoint: goal Background responsiveness, acceptance [Main answers during child execution, Pending child survives idle], nextAction Launch bounded background child, status active. Deliberately call task subagent_type maintainer with background false and prompt Return SKIPPED: no documentation impact; foreground execution must be accepted. Then launch the same maintainer with background true when supported. Launch one background-child with background true: execute powershell -NoProfile -Command "Start-Sleep -Seconds 35" exactly once, then return CHILD_DONE. Save both returned task IDs in sdlc_checkpoint pending; status waiting; nextAction Handle new user input while tasks run. Say BACKGROUND_STARTED and return control. Do not await, poll, sleep yourself, use MCP, edit files or call other tools.');
  let buffer = '';
  const decoder = new TextDecoder();
  while (!finished) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Event stream ended before acceptance completed.');
    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').find(line => line.startsWith('data: '));
      if (!data) continue;
      const raw = JSON.parse(data.slice(6)); const event = raw.payload ?? raw;
      const part = event.properties?.part;
      if (event.type === 'session.error' && event.properties.sessionID === session.id) throw new Error('Parent session failed. Inspect private server diagnostics.');
      if (part?.type === 'tool' && part.tool === 'task' && part.state.status === 'completed' && part.state.input.subagent_type === 'background-child') {
        childID = part.state.output.match(/<task id="([^"]+)"/)?.[1];
        assert.ok(childID, 'Native background tool must return a task ID.');
      }
      if (event.type !== 'session.idle' || event.properties.sessionID !== session.id || !childID) continue;
      if (!secondSent) {
        firstCheckpoint = checkpoint();
        assert.ok(firstCheckpoint.pending.some(item => item.includes(childID)), 'Pending child must persist after parent idle.');
        secondSent = true;
        await send('Independent second user message: say INTERACTION_ACK immediately without waiting for the child or using tools. Keep the existing checkpoint and pending task IDs.');
      } else {
        const history = await request(`/session/${session.id}/message`);
        const parts = history.flatMap(message => message.parts ?? []);
        if (!secondCheckpoint && parts.some(part => part.type === 'text' && part.text.includes('INTERACTION_ACK'))) {
          secondCheckpoint = checkpoint();
          assert.ok(secondCheckpoint.pending.some(item => item.includes(childID)), 'Pending child must survive a second user turn.');
        }
        finished = parts.some(part => part.type === 'text' && part.text.includes(`<task id="${childID}" state="completed">`));
      }
    }
  }
  const [parent, child] = await Promise.all([request(`/session/${session.id}/message`), request(`/session/${childID}/message`)]);
  const tools = parent.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool');
  assert.ok(tools.some(part => part.tool === 'task' && part.state.input.subagent_type === 'maintainer' && part.state.status === 'completed' && part.state.input.background === false), 'Foreground maintainer must be accepted.');
  assert.ok(tools.some(part => part.tool === 'task' && part.state.input.subagent_type === 'maintainer' && part.state.input.background === true && part.state.status === 'completed'), 'Background maintainer must be accepted.');
  const bash = child.flatMap(message => message.parts ?? []).find(part => part.type === 'tool' && part.tool === 'bash' && part.state.status === 'completed');
  assert.ok(bash, 'Child must execute its bounded command.');
  const acknowledgement = parent.find(message => message.info.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text.includes('INTERACTION_ACK')));
  assert.ok(acknowledgement?.info.time.completed >= bash.state.time.start, 'Child command must already be running when the second answer finishes.');
  assert.ok(acknowledgement?.info.time.completed < bash.state.time.end, 'Second answer must finish before the child command.');
  assert.ok(secondCheckpoint, 'Second-turn checkpoint evidence must exist.');
  assert.equal(firstCheckpoint.startupHealth[session.id].checkpoints.status, 'PASS');
  assert.equal(firstCheckpoint.startupHealth[session.id].harnessVersion, '2026-10-13-background-handoff');
  const maintainer = tools.find(part => part.tool === 'task' && part.state.input.subagent_type === 'maintainer' && part.state.status === 'completed');
  const maintainerID = maintainer.state.output.match(/<task id="([^"]+)"/)?.[1];
  assert.ok(maintainerID);
  // A completed child must retain the asynchronous rule when resumed by task_id.
  const followupController = new AbortController();
  const followupStream = await fetch(base + '/event', { signal: followupController.signal });
  const followupReader = followupStream.body.getReader();
  const followupNotification = (async () => {
    let pending = '';
    while (true) {
      const chunk = await followupReader.read();
      if (chunk.done) throw new Error('Follow-up event stream ended early.');
      pending += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const line = block.split('\n').find(item => item.startsWith('data: '));
        if (!line) continue;
        const raw = JSON.parse(line.slice(6)), event = raw.payload ?? raw;
        const part = event.properties?.part;
        if (part?.sessionID === session.id && part.type === 'text' && part.text.includes(`<task id="${maintainerID}" state="completed">`) && part.text.includes('FOLLOWUP_BACKGROUND')) return;
      }
    }
  })();
  try {
    await request(`/session/${session.id}/message`, { agent: 'background-probe', model: { providerID: 'openai', modelID: 'gpt-6-luna' }, parts: [{ type: 'text', text: `Read-only follow-up acceptance. First task subagent_type maintainer task_id ${maintainerID} background false prompt Return SKIPPED: FOLLOWUP_FOREGROUND. Foreground execution is supported. Then task subagent_type maintainer with the SAME task_id background true prompt Return SKIPPED: FOLLOWUP_BACKGROUND. Return control; no polling, other tasks or edits.` }] });
    await Promise.race([followupNotification, new Promise((_, reject) => setTimeout(() => reject(new Error('Maintainer follow-up notification timed out.')), 45000).unref())]);
    const followupHistory = await request(`/session/${session.id}/message`);
    const followupTools = followupHistory.flatMap(message => message.parts ?? []).filter(part => part.tool === 'task' && part.state.input.task_id === maintainerID);
    assert.ok(followupTools.some(part => part.state.status === 'completed' && part.state.input.background === false), 'Foreground maintainer follow-up must be accepted.');
    assert.ok(followupTools.some(part => part.state.status === 'completed' && part.state.input.background === true), 'Background maintainer follow-up must be accepted.');
    const childHistory = await request(`/session/${maintainerID}/message`);
    assert.ok(childHistory.some(message => message.info.role === 'assistant' && message.info.agent === 'maintainer' && message.parts.some(part => part.type === 'text' && part.text.includes('FOLLOWUP_BACKGROUND'))));
  } finally { followupController.abort(); }
  console.log(JSON.stringify({ version: health.version, harnessVersion: firstCheckpoint.startupHealth[session.id].harnessVersion, externalPlugins: true, parentSession: session.id, childSession: childID, foregroundMaintainerAccepted: true, backgroundMaintainerAccepted: true, foregroundMaintainerFollowupAccepted: true, backgroundMaintainerFollowupAccepted: true, checkpointPendingSurvivesIdleAndSecondTurn: true, mainAnswersBeforeChildCompletes: true, automaticCompletionNotification: true, integrationStatus: { graph: firstCheckpoint.startupHealth[session.id].graph.status, hindsight: firstCheckpoint.startupHealth[session.id].hindsight.status } }));
} finally {
  clearTimeout(timeout); controller.abort(); db?.close();
}
