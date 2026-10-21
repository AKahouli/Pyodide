import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeBrowserReport } from './benchmark-classic-conversation-sse-browser.mjs';

test('deadline during final browser evaluation stays failed when evaluation later succeeds', async () => {
  const report = { smokePass: false, code: 'generation_or_paint_failed', cleanup: { unresolved: false } };
  let finishEvaluation;
  const evaluation = new Promise(resolve => { finishEvaluation = resolve; });
  const lateWork = evaluation.then(() => { report.smokePass = true; report.code = 'ok'; report.cleanup.unresolved = true; });
  // Deadline wins while the final browser operation is still outstanding.
  const finalized = finalizeBrowserReport(report, true);
  finishEvaluation();
  await lateWork;
  assert.equal(finalized.smokePass, false);
  assert.equal(finalized.code, 'deadline');
  assert.equal(finalized.cleanup.unresolved, false);
});

test('a successful finalized outcome is detached from later mutable work state', () => {
  const report = { smokePass: true, code: 'ok' };
  const finalized = finalizeBrowserReport(report, false);
  report.smokePass = false;
  assert.equal(finalized.smokePass, true);
});
