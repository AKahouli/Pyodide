import { openHarness } from '../runtime/lib/sdlc-core.mjs';

const [root, id, mode = 'writes'] = process.argv.slice(2);
const harness = await openHarness(root);
harness.checkpoint(id, { goal: `Task ${id}`, acceptance: ['Preserve independent state'], nextAction: 'Continue', status: 'active' });
if (mode === 'writes') {
  for (let index = 0; index < 40; index++) harness.checkpoint(id, { completed: [`step-${index}`] });
  harness.close();
  process.send?.({ done: true });
} else {
  process.send?.({ ready: true });
  setInterval(() => {}, 1000);
}
