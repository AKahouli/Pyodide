import { openHarness } from '../runtime/lib/sdlc-core.mjs';

const [root, id, mode = 'writes'] = process.argv.slice(2);
const harness = await openHarness(root);
harness.checkpoint(id, { goal: `Task ${id}`, acceptance: ['Preserve independent state'], nextAction: 'Continue', status: 'active' });
if (mode === 'writes') {
  for (let index = 0; index < 40; index++) harness.checkpoint(id, { completed: [`step-${index}`] });
  harness.close();
  process.send?.({ done: true });
} else {
  for (const file of ['docs/agent-context/README.md', 'guidelines.md', 'src/a.js']) harness.noteRead(id, file, harness.fingerprint(file));
  harness.prepare(id, { targets: ['src/a.js'], documents: ['docs/agent-context/README.md', 'guidelines.md'], sources: ['src/a.js'], reuseDecision: 'Extend the existing function.' });
  harness.beforeEdit(id, ['src/a.js'], 'interrupted-edit');
  process.send?.({ claimed: true });
  setInterval(() => {}, 1000);
}
