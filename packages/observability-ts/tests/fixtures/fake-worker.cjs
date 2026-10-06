'use strict';
// Test double: holds dispatched lines until the test sends {t:'ackall'} — makes credit,
// reserve and shutdown behavior deterministic without OS pipe timing.
const { parentPort } = require('worker_threads');
let held = [];
parentPort.on('message', (m) => {
  if (m.t === 'w') {
    held.push(m.lines);
  } else if (m.t === 'ackall') {
    for (const lines of held) {
      parentPort.postMessage({
        t: 'ack',
        n: lines.length,
        b: lines.reduce((s, l) => s + Buffer.byteLength(l, 'utf8') + 1, 0),
      });
    }
    held = [];
  } else if (m.t === 'die') {
    process.exit(1);
  } else if (m.t === 'end') {
    parentPort.postMessage({ t: 'ended' });
  }
});
