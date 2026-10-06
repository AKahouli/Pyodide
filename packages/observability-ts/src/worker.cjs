'use strict';
// Writer worker (one per process). Owns the stderr file descriptor via SonicBoom (EAGAIN/partial-write
// handling) and never touches the parent's event loop. Credits are acked only after SonicBoom accepts
// each line; maxLength bounds the accepted-but-unwritten buffer and overflow is reported as a drop.
const { parentPort } = require('worker_threads');
const SonicBoom = require('sonic-boom');

// OBS_WRITER_FD lets tests redirect the sink (default: stderr); OBS_SINK_MAX_BYTES bounds SonicBoom's buffer.
const FD = Number.parseInt(process.env.OBS_WRITER_FD ?? '2', 10);
const SINK_MAX_BYTES = Number.parseInt(process.env.OBS_SINK_MAX_BYTES ?? '4194304', 10);
const sonic = new SonicBoom({
  fd: FD,
  sync: false,
  minLength: 4096,
  maxLength: SINK_MAX_BYTES,
  maxWriteRetries: 20,
});
let pending = []; // [{ line, b }]
let pendingBytes = 0;
let currentGen = 0; // parent's spawn generation, echoed on asynchronous events

function ack(gen, n, b) {
  if (n > 0) parentPort.postMessage({ t: 'ack', gen, n, b });
}
function drop(gen, n, b, reason) {
  if (n > 0) parentPort.postMessage({ t: 'drop', gen, n, b, reason });
}

function tryFlush(gen) {
  let ackN = 0;
  let ackB = 0;
  while (pending.length > 0) {
    const it = pending[0];
    let ok;
    try {
      ok = sonic.write(it.line + '\n');
    } catch (err) {
      pending.shift();
      pendingBytes -= it.b;
      ack(gen, ackN, ackB);
      drop(gen, 1, it.b, 'write_error');
      continue;
    }
    pending.shift();
    pendingBytes -= it.b;
    ackN += 1;
    ackB += it.b; // exact event bytes: parent admitted the same amount
    if (!ok) {
      ack(gen, ackN, ackB);
      return; // SonicBoom accepted into its maxLength-bounded buffer; resume on drain
    }
  }
  ack(gen, ackN, ackB);
}

parentPort.on('message', (m) => {
  if (m.t === 'w') {
    currentGen = m.gen;
    for (const line of m.lines) {
      const b = Buffer.byteLength(line, 'utf8');
      pending.push({ line, b });
      pendingBytes += b;
    }
    tryFlush(m.gen);
  } else if (m.t === 'end') {
    currentGen = m.gen;
    tryFlush(m.gen);
    sonic.end();
    sonic.on('close', () => parentPort.postMessage({ t: 'ended', gen: m.gen }));
  }
});

sonic.on('drain', () => {
  if (pending.length > 0) tryFlush(currentGen);
});
sonic.on('error', () => {
  // Sink failure: lose what is still held rather than crash the worker or retry unbounded.
  drop(currentGen, pending.length, pendingBytes, 'sink_error');
  pending = [];
  pendingBytes = 0;
});
sonic.on('drop', () => {
  // maxLength exceeded inside SonicBoom's buffer: bounded loss, honestly counted.
  drop(currentGen, 1, 0, 'sink_overflow');
});

// SonicBoom buffers below minLength until end(); without this a quiet service's
// acked events would never reach the sink. Bounded delivery delay instead.
// flush() after end() only races teardown. Known limit: events already inside
// SonicBoom's buffer that fail during a flush are lost uncounted — the 'error'/'drop'
// handlers only see the worker-side pending queue. Pre-existing gap, reachable via this timer.
setInterval(() => { try { sonic.flush(); } catch { /* teardown race, see above */ } }, 500).unref();
