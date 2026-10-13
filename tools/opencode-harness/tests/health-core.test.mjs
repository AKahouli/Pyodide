import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openHarness } from '../runtime/lib/sdlc-core.mjs';
import { fixture } from './fixture.mjs';

const passing = { graph: { status: 'PASS', reason: 'Scoped graph query completed.' }, hindsight: { status: 'PASS', reason: 'Daemon and integration verified.' } };
const goal = { goal: 'Verify session isolation', acceptance: ['Session owns its receipt'], nextAction: 'Continue', status: 'active' };

if (process.argv[2] === '--health-worker') {
  const [root, sessionID] = process.argv.slice(3);
  const h = await openHarness(root, { requireStartupHealth: true });
  for (let index = 0; index < 20; index++) {
    h.health(sessionID, { ...passing, graph: { status: 'PASS', reason: `${sessionID}-${index}` } });
    h.checkpoint(sessionID, { ...goal, completed: [`${sessionID}-${index}`] });
    h.requireHealthy(sessionID);
  }
  process.send({ receipt: h.health(sessionID) });
  process.once('message', () => { h.close(); process.exit(0); });
} else {
  test('health verifies actual checkpoint persistence and gates edits without overwriting progress', async () => {
    const f = fixture(); const h = await openHarness(f.root, { requireStartupHealth: true });
    try {
      h.checkpoint('session-a', { ...goal, checks: [{ name: 'Existing evidence', status: 'PASS', files: ['src/a.js'] }] });
      assert.equal(h.health('session-a'), null);
      assert.throws(() => h.requireHealthy('session-a'), /not been verified/);
      assert.throws(() => h.prepare('session-a', {}), /startup health/);
      assert.throws(() => h.beforeEdit('session-a', ['src/a.js'], 'edit'), /startup health/);
      assert.equal(h.shellAllowed('session-a', 'git status'), true);
      assert.throws(() => h.shellAllowed('session-a', 'git commit -m verified'), /startup health/);
      const receipt = h.health('session-a', { ...passing, root: 'wrong', sessionID: 'wrong', checkpoints: { status: 'FAIL' } });
      assert.equal(receipt.root, h.root);
      assert.equal(receipt.sessionID, 'session-a');
      assert.equal(receipt.checkpoints.status, 'PASS');
      assert.equal(h.requireHealthy('session-a').probe, receipt.probe);
      assert.equal(h.shellAllowed('session-a', 'git commit -m verified'), true);
      h.health('session-a', { ...passing, graph: { status: 'FAIL', reason: 'Wrong root', action: 'Check this repository graph' } });
      assert.throws(() => h.requireHealthy('session-a'), /graph FAIL: Wrong root.*Check this repository graph/);
      h.health('session-a', { ...passing, hindsight: { status: 'PENDING', reason: 'Checking recall' } });
      assert.throws(() => h.requireHealthy('session-a'), /hindsight PENDING/);
      assert.equal(h.state('session-a').checks[0].status, 'PASS');
      assert.deepEqual(h.state('session-a').files, {});
      assert.throws(() => h.health('session-a', { graph: { status: 'SKIPPED' }, hindsight: passing.hindsight }), /explicit graph status/);
    } finally { h.close(); f.cleanup(); }
  });

  test('startup receipts survive same-session task generations but not owner restart or resume from another session', async () => {
    const f = fixture(); let h = await openHarness(f.root, { requireStartupHealth: true });
    try {
      h.health('old', passing); h.checkpoint('old', goal);
      const original = h.state('old').id;
      h.park('old');
      h.health('fresh', { ...passing, graph: { status: 'FAIL', reason: 'Fresh session has no graph evidence' } });
      h.resume('fresh', original);
      assert.throws(() => h.requireHealthy('fresh'), /Fresh session has no graph evidence/);
      assert.throws(() => h.health('old'), /moved to session/);
      const receipt = h.health('fresh', passing);
      h.checkpoint('fresh', { ...goal, newTask: true });
      assert.equal(h.requireHealthy('fresh').probe, receipt.probe);
      h.close(); h = await openHarness(f.root, { requireStartupHealth: true });
      assert.equal(h.health('fresh'), null);
      assert.throws(() => h.requireHealthy('fresh'), /not been verified/);
      h.health('fresh', passing);
      assert.equal(h.requireHealthy('fresh').graph.status, 'PASS');
    } finally { h.close(); f.cleanup(); }
  });

  test('two real processes sharing the checkpoint database isolate receipts and refuse live owner takeover', async () => {
    const f = fixture(); let h; const children = [];
    try {
      const messages = ['parallel-a', 'parallel-b'].map(id => {
        const child = fork(new URL(import.meta.url), ['--health-worker', f.root, id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], windowsHide: true });
        children.push(child);
        return once(child, 'message');
      });
      const receipts = (await Promise.all(messages)).map(([message]) => message.receipt);
      assert.notEqual(receipts[0].processID, receipts[1].processID);
      assert.notEqual(receipts[0].ownerToken, receipts[1].ownerToken);
      assert.equal(receipts[0].graph.reason, 'parallel-a-19');
      assert.equal(receipts[1].graph.reason, 'parallel-b-19');
      h = await openHarness(f.root, { requireStartupHealth: true });
      assert.throws(() => h.health('parallel-a'), /another live OpenCode process/);
      assert.throws(() => h.health('parallel-b', passing), /another live OpenCode process/);
      h.health('parent', { ...passing, hindsight: { status: 'FAIL', reason: 'Parent integration unavailable' } });
      assert.throws(() => h.requireHealthy('parent'), /Parent integration unavailable/);
      assert.equal(h.state('parallel-a').completed[0], 'parallel-a-19');
      assert.equal(h.state('parallel-b').completed[0], 'parallel-b-19');
      await Promise.all(children.map(child => { const exit = once(child, 'exit'); child.send('close'); return exit; }));
      assert.equal(h.health('parallel-a'), null);
      h.health('parallel-a', passing);
      assert.equal(h.requireHealthy('parallel-a').sessionID, 'parallel-a');
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
      h?.close(); f.cleanup();
    }
  });
}
