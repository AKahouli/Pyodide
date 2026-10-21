import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frames, distribution, validate, benchmark, compare, peakIntervalOverlap } from './benchmark-classic-conversation-sse.mjs';

test('incremental CRLF/multiline SSE preserves cursor across byte boundaries', () => {
  const parser = new Frames();
  assert.deepEqual(parser.push('id: pg:1:9\r\nevent: stream_chunk\r\ndata: {"v":'), []);
  assert.deepEqual(parser.push('1}\r\n\r\n'), [{ id: 'pg:1:9', type: 'stream_chunk', data: { v: 1 } }]);
});
test('unterminated frame cannot grow without bound', () => {
  assert.throws(() => new Frames().push('x'.repeat(2 * 1024 * 1024 + 1)), /frame_limit/);
});
test('classic response envelope supplies event type and durable cursor instead of auto wire ID', () => {
  const parser = new Frames();
  assert.deepEqual(parser.push('id: 7\ndata: {"type":"stream_chunk","id":"pg:1:99","data":{"revision":2}}\n\n'),
    [{ type: 'stream_chunk', id: 'pg:1:99', data: { revision: 2 } }]);
});
test('empty and nearest-rank distributions do not invent samples', () => {
  assert.equal(distribution([]).p95, null);
  assert.equal(distribution([100, 1, 2]).p95, 100);
});
test('adapter interval overlap excludes touching and invalid intervals', () => {
  assert.equal(peakIntervalOverlap([[0, 1], [1, 2], [NaN, 4], [4, 3]]), 1);
  assert.equal(peakIntervalOverlap([[0, 4], [1, 3], [2, 5]]), 3);
});
test('rejects non-isolated workloads before contacting any endpoint', () => {
  assert.throws(() => validate({ isolated: false }), /isolated_environment_required/);
});
test('baseline comparison rejects changed model and keeps failed budget visible', () => {
  const workload = { users: 30, tabs: 5, replicas: 2, model: 'pinned', dataset: 'fixed', hardware: 'fixed', promptDigest: 'fixed' };
  const baseline = { sha: 'baseline', workload, ttftMs: { p50: 100, p95: 200 }, transportPass: true };
  const measured = { sha: 'measured', workload: { ...workload, baselineSha: 'baseline' }, ttftMs: { p50: 111, p95: 201 }, transportPass: true };
  assert.equal(compare(baseline, measured).provisionalTtftBudgetPass, false);
  assert.throws(() => compare(baseline, { ...measured, workload: { ...measured.workload, model: 'other' } }), /baseline_workload_mismatch/);
});

async function fixture(mode) {
  const identities = Array.from({ length: 10 }, (_, index) => ({
    userId: index.toString(16).padStart(24, '0'), conversationId: (index + 100).toString(16).padStart(24, '0'), tokenEnv: `PR06_UNIT_${index}`,
  }));
  const previous = identities.map(identity => process.env[identity.tokenEnv]);
  for (const identity of identities) process.env[identity.tokenEnv] = `test.${Buffer.from(JSON.stringify({ sub: identity.userId, exp: Date.now() / 1000 + 3600 })).toString('base64url')}.test`;
  const originalFetch = globalThis.fetch, readers = new Map();
  let stops = 0, cursor = 0;
  const frame = (controller, type, data) => controller.enqueue(new TextEncoder().encode(`${mode === 'missing-id' ? '' : `id: pg:1:${++cursor}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/stop')) { stops++; assert.equal(options.signal.aborted, false); return new Response('{}'); }
    const sub = JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1], 'base64url')).sub;
    const index = identities.findIndex(identity => identity.userId === sub);
    if (!options.method && !url.endsWith('/stream')) return new Response('{}', { status: mode === 'forged-history' ? 403 : 200 });
    if (url.endsWith('/stream')) {
      let open = true;
      return new Response(new ReadableStream({ start(controller) {
        readers.set(index, controller);
        frame(controller, 'connected', {});
        options.signal.addEventListener('abort', () => { if (open) { open = false; controller.close(); } }, { once: true });
      }, cancel() { open = false; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (mode === 'unavailable') return new Response('{}', { status: 503 });
    const data = { conversationId: identities[index].conversationId, messageId: `message-${index}` };
    if (mode === 'error-after-start') {
      frame(readers.get(index), 'stream_start', data);
      await new Promise(resolve => setImmediate(resolve));
      return new Response('{}', { status: 500 });
    }
    // Intentionally serialized mocked execution: cannot establish real model overlap.
    queueMicrotask(() => {
      const reader = readers.get(index);
      if (mode === 'owned-history') frame(reader, 'stream_chunk', { conversationId: (index + 200).toString(16).padStart(24, '0') });
      frame(reader, 'stream_start', data);
      if (mode === 'failure') { if (index === 0) frame(reader, 'stream_error', data); return; }
      frame(reader, 'stream_chunk', { ...data, latency: { backendFirstDeltaWrittenEpochMs: Date.now(), metrics: {} } });
      frame(reader, 'stream_complete', { ...data, usage: { outputTokens: 1 } });
    });
    return new Response(JSON.stringify({ aiMessageId: data.messageId }), { status: 201 });
  };
  try {
    if (['owned-history', 'forged-history'].includes(mode)) identities.forEach((identity, index) => {
      identity.allowedConversationIds = [(index + 200).toString(16).padStart(24, '0')];
    });
    const report = await benchmark({ isolated: true, users: 10, tabs: 1, replicas: ['http://replica-a/api/v1', 'http://replica-b/api/v1'],
      identities, prompts: ['test'], model: 'mock', dataset: 'mock', hardware: 'mock', deployment: 'mock', baselineSha: 'mock' });
    return { report, stops };
  } finally {
    globalThis.fetch = originalFetch;
    identities.forEach((identity, index) => { if (previous[index] === undefined) delete process.env[identity.tokenEnv]; else process.env[identity.tokenEnv] = previous[index]; });
  }
}
test('missing durable IDs fail even if every tab would otherwise match', async () => {
  const { report, stops } = await fixture('missing-id');
  assert.equal(report.transportPass, false);
  assert.ok(report.failures.includes('missing_durable_cursor'));
  assert.equal(stops, 10);
});
test('failed stream cancels accepted unfinished model turns using independent signals', async () => {
  const { report, stops } = await fixture('failure');
  assert.equal(report.transportPass, false);
  assert.equal(stops, 10);
  assert.deepEqual(report.cleanup, { stopped: 10, unresolved: 0 });
});
test('received stream overlap never proves real concurrent model execution', async () => {
  const { report, stops } = await fixture('success');
  assert.equal(stops, 0);
  assert.equal(report.realGenerationOverlapVerified, false);
  assert.equal(report.releaseQualified, false);
  assert.ok(report.missingEvidence.includes('authoritative concurrent model/provider execution intervals'));
});
test('unknown-ID HTTP 5xx outcomes remain uncertain and require cleanup inspection', async () => {
  const { report, stops } = await fixture('unavailable');
  assert.equal(report.transportPass, false);
  assert.deepEqual(report.sendStatuses, { 503: 10 });
  assert.equal(stops, 0);
  assert.equal(report.cleanup.unresolved, 10);
});
test('observed turn is stopped despite an HTTP error after streaming starts', async () => {
  const { report, stops } = await fixture('error-after-start');
  assert.equal(report.transportPass, false);
  assert.deepEqual(report.sendStatuses, { 500: 10 });
  assert.equal(stops, 10);
  assert.equal(report.cleanup.unresolved, 0);
});
test('other authorized actor-history events are distinguished from foreign events', async () => {
  const { report } = await fixture('owned-history');
  assert.equal(report.counters.foreign, 0);
  assert.equal(report.counters.otherAuthorizedConversationEvents, 10);
});
test('unverified ownership allowlists cannot hide foreign events', async () => {
  await assert.rejects(fixture('forged-history'), /owned_history_authorization_failed/);
});
