import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { openHarness, editTargets } from '../runtime/lib/sdlc-core.mjs';
import { fixture } from './fixture.mjs';

function start(harness, id) { harness.checkpoint(id, { goal: 'Improve existing behavior', acceptance: ['Required behavior passes'], nextAction: 'Extend existing function', status: 'active' }); }
function reads(harness, id, files = ['docs/agent-context/README.md', 'guidelines.md', 'src/a.js']) { for (const file of files) harness.noteRead(id, file, harness.fingerprint(file)); }
function prepare(harness, id, target = 'src/a.js') { return harness.prepare(id, { targets: [target], documents: ['docs/agent-context/README.md', 'guidelines.md'], sources: [target], reuseDecision: 'Extend the current implementation.' }); }

test('repository policy requires short scoped instructions for frontend and backend edits', async () => {
  const f = fixture(); let h;
  try {
    const policy = JSON.parse(readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
    writeFileSync(path.join(f.root, 'tools/opencode-harness/policy.json'), JSON.stringify(policy));
    for (const area of ['front', 'back']) {
      mkdirSync(path.join(f.root, `YellowStorm/${area}/src`), { recursive: true });
      writeFileSync(path.join(f.root, `YellowStorm/${area}/AGENTS.md`), '# Scoped instructions\nRead relevant linked topics.\n');
      writeFileSync(path.join(f.root, `YellowStorm/${area}/src/existing.js`), 'export const value = 1;\n');
    }
    h = await openHarness(f.root);
    for (const area of ['front', 'back']) {
      const target = `YellowStorm/${area}/src/existing.js`, scoped = `YellowStorm/${area}/AGENTS.md`;
      start(h, area); reads(h, area, ['docs/agent-context/README.md', target]);
      const input = { targets: [target], documents: ['docs/agent-context/README.md'], sources: [target], reuseDecision: 'Extend existing behavior.' };
      assert.throws(() => h.prepare(area, input), /required documentation: YellowStorm\/.*\/AGENTS.md/i);
      reads(h, area, [scoped]); input.documents.push(scoped); h.prepare(area, input);
      h.beforeEdit(area, [target], area); h.afterEdit(area, area);
      writeFileSync(path.join(f.root, scoped), '# Updated scoped rules\n');
      assert.throws(() => h.beforeEdit(area, [target], 'stale'), /Context .* changed/);
    }
  } finally { h?.close(); f.cleanup(); }
});

test('edits need current documentation, source reuse, target reads and ownership', async () => {
  const f = fixture(); const h = await openHarness(f.root);
  try {
    assert.throws(() => h.beforeEdit('a', ['src/a.js'], 'one'), /sdlc_prepare/);
    start(h, 'a');
    assert.throws(() => prepare(h, 'a'), /Use Read/);
    reads(h, 'a'); prepare(h, 'a');
    h.beforeEdit('a', ['src/a.js'], 'one');
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 3;\n');
    h.afterEdit('a', 'one');
    assert.match(h.diff('a', 'src/a.js').diff, /\+export const value = 3/);
    start(h, 'b'); reads(h, 'b');
    assert.throws(() => prepare(h, 'b'), /belongs to task a/);
    reads(h, 'b', ['src/b.js']); prepare(h, 'b', 'src/b.js');
    writeFileSync(path.join(f.root, 'guidelines.md'), '# Changed policy\n');
    assert.throws(() => h.beforeEdit('a', ['src/a.js'], 'two'), /Context .* changed/);
  } finally { h.close(); f.cleanup(); }
});

test('parallel processes preserve independent checkpoints and recover a killed edit', async () => {
  const f = fixture(); let h; let crashed;
  const worker = new URL('./process-worker.mjs', import.meta.url);
  try {
    const children = ['parallel-a', 'parallel-b'].map(id => fork(worker, [f.root, id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], windowsHide: true }));
    const exits = await Promise.all(children.map(child => once(child, 'exit')));
    assert.ok(exits.every(([code]) => code === 0));
    h = await openHarness(f.root);
    assert.deepEqual(h.state('parallel-a').completed, ['step-39']);
    assert.deepEqual(h.state('parallel-b').completed, ['step-39']);
    crashed = fork(worker, [f.root, 'crashed', 'claim'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], windowsHide: true });
    await once(crashed, 'message');
    assert.throws(() => h.resume('new-session', 'crashed'), /original task is active/);
    start(h, 'unrelated'); reads(h, 'unrelated');
    assert.throws(() => prepare(h, 'unrelated'), /belongs to task crashed/);
    const exit = once(crashed, 'exit'); crashed.kill('SIGKILL'); await exit;
    const recovered = h.resume('new-session', 'crashed');
    assert.equal(recovered.id, 'crashed');
    assert.equal(recovered.recovery.interruptedOperation.callID, 'interrupted-edit');
    assert.throws(() => h.beforeEdit('new-session', ['src/a.js'], 'new'), /sdlc_prepare/);
    reads(h, 'new-session'); prepare(h, 'new-session');
    h.beforeEdit('new-session', ['src/a.js'], 'new'); h.afterEdit('new-session', 'new');
    assert.throws(() => h.beforeEdit('crashed', ['src/a.js'], 'old'), /moved to session/);
  } finally { if (crashed?.exitCode === null && crashed?.signalCode === null) crashed.kill(); h?.close(); f.cleanup(); }
});

test('resume never guesses an unrelated task and invalidates stale checks', async () => {
  const f = fixture(); const h = await openHarness(f.root);
  try {
    for (const id of ['a', 'b']) { start(h, id); h.park(id); }
    assert.equal(h.autoResume('fresh', 'Implement another feature'), null);
    assert.equal(h.autoResume('fresh', 'resume').resumeCandidates.length, 2);
    h.checkpoint('a', { checks: [{ name: 'Focused verification', status: 'PASS', files: ['src/a.js'] }] });
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 4;\n');
    const resumed = h.autoResume('fresh', 'resume task a.');
    assert.equal(resumed.id, 'a');
    assert.equal(resumed.checks[0].status, 'HISTORICAL');
    assert.throws(() => h.resume('third', 'a'), /original task is active/);
    h.park('fresh'); h.activate('fresh');
    assert.throws(() => h.resume('third', 'a'), /original task is active/);
  } finally { h.close(); f.cleanup(); }
});

test('baseline excludes earlier dirty changes, shell writes fail, ready status survives idle', async () => {
  const f = fixture(); writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 9;\n');
  const h = await openHarness(f.root);
  try {
    start(h, 'a'); reads(h, 'a'); prepare(h, 'a');
    assert.equal(h.state('a').initialChanges.paths.some(entry => entry.path === 'src/a.js'), true);
    h.beforeEdit('a', ['src/a.js'], 'one');
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 10;\n'); h.afterEdit('a', 'one');
    const diff = h.diff('a', 'src/a.js').diff;
    assert.match(diff, /-export const value = 9/); assert.doesNotMatch(diff, /-export const value = 1;/);
    assert.equal(h.shellAllowed('a', 'git status --short'), true);
    assert.equal(h.shellAllowed('a', 'npm test -- focused'), true);
    assert.equal(h.shellAllowed('a', 'node -e "writeFileSync()"'), false);
    assert.equal(h.shellAllowed('a', 'npm test; echo changed > src/a.js'), false);
    h.checkpoint('a', { status: 'ready' }); h.park('a');
    assert.equal(h.state('a').status, 'ready');
    assert.throws(() => h.beforeEdit('a', ['src/a.js'], 'two'), /sdlc_prepare/);
  } finally { h.close(); f.cleanup(); }
});

test('patch targets include rename sources/destinations and external drift blocks exact diff', async () => {
  assert.deepEqual(editTargets('apply_patch', { patchText: '*** Update File: src/a.js\n*** Move to: src/b.js\n*** Add File: src/c.js\n*** Delete File: src/d.js' }), ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']);
  const f = fixture(); const h = await openHarness(f.root);
  try {
    start(h, 'a'); reads(h, 'a'); prepare(h, 'a');
    h.beforeEdit('a', ['src/a.js'], 'one'); h.afterEdit('a', 'one');
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const external = 100;\n');
    assert.throws(() => h.diff('a', 'src/a.js'), /outside the task/);
    reads(h, 'a'); prepare(h, 'a');
    assert.throws(() => h.diff('a', 'src/a.js'), /outside the task/);
    assert.throws(() => h.fingerprint('../outside'), /inside this worktree/);
    assert.throws(() => h.fingerprint('.env'), /environment secrets/);
  } finally { h.close(); f.cleanup(); }
});

test('new tasks in one chat get independent baselines and reviewers can read parent scope', async () => {
  const f = fixture(); const h = await openHarness(f.root);
  try {
    start(h, 'chat'); reads(h, 'chat'); prepare(h, 'chat');
    h.beforeEdit('chat', ['src/a.js'], 'first');
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 3;\n'); h.afterEdit('chat', 'first');
    h.checkpoint('chat', { status: 'completed' });
    const next = h.checkpoint('chat', { newTask: true, goal: 'Second task', acceptance: ['Second change'], nextAction: 'Update existing function', status: 'active' });
    assert.notEqual(next.taskID, 'chat');
    reads(h, 'chat'); prepare(h, 'chat'); h.beforeEdit('chat', ['src/a.js'], 'second');
    writeFileSync(path.join(f.root, 'src/a.js'), 'export const value = 4;\n'); h.afterEdit('chat', 'second');
    const scoped = h.diff('review-child', 'src/a.js', next.taskID).diff;
    assert.match(scoped, /-export const value = 3/);
    assert.doesNotMatch(scoped, /-export const value = 1;/);
  } finally { h.close(); f.cleanup(); }
});

test('different worktrees isolate identical task/file identifiers', async () => {
  const a = fixture(); const b = fixture(); const first = await openHarness(a.root); const second = await openHarness(b.root);
  try {
    for (const h of [first, second]) { start(h, 'same-id'); reads(h, 'same-id'); prepare(h, 'same-id'); }
    assert.notEqual(first.filename, second.filename);
    assert.notEqual(first.state('same-id').root, second.state('same-id').root);
    first.beforeEdit('same-id', ['src/a.js'], 'a'); second.beforeEdit('same-id', ['src/a.js'], 'b');
    first.afterEdit('same-id', 'a'); second.afterEdit('same-id', 'b');
  } finally { first.close(); second.close(); a.cleanup(); b.cleanup(); }
});

test('linked Git worktrees resolve packed refs and keep independent checkpoints', async () => {
  const f = fixture(); const linked = path.join(f.root, 'linked-worktree');
  const git = args => execFileSync('git', args, { cwd: f.root, stdio: 'pipe', windowsHide: true });
  let first, second;
  try {
    git(['worktree', 'add', '-b', 'parallel-test', linked]);
    git(['pack-refs', '--all', '--prune']);
    first = await openHarness(f.root); second = await openHarness(linked);
    start(first, 'same'); start(second, 'same');
    assert.equal(second.state('same').branch, 'parallel-test');
    assert.equal(second.state('same').head, first.state('same').head);
    assert.notEqual(second.filename, first.filename);
    for (const h of [first, second]) { reads(h, 'same'); prepare(h, 'same'); h.beforeEdit('same', ['src/a.js'], 'edit'); h.afterEdit('same', 'edit'); }
  } finally {
    first?.close(); second?.close();
    try { git(['worktree', 'remove', '--force', linked]); } finally { f.cleanup(); }
  }
});
