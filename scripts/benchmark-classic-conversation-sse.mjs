#!/usr/bin/env node
// No credentials/payloads in reports. Uses existing authenticated HTTP routes.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname, cpus, totalmem, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function distribution(values) {
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99) };
}

export function peakIntervalOverlap(intervals) {
  const edges = intervals.flatMap(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start < end ? [[start, 1], [end, -1]] : []);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0;
  for (const [, delta] of edges) { active += delta; peak = Math.max(peak, active); }
  return peak;
}

export function compare(baseline, measured) {
  const fields = ['users', 'tabs', 'replicas', 'model', 'dataset', 'hardware', 'promptDigest'];
  if (fields.some(field => baseline.workload[field] !== measured.workload[field]) || baseline.sha !== measured.workload.baselineSha) throw new Error('baseline_workload_mismatch');
  const ratios = {};
  for (const key of ['p50', 'p95']) {
    if (!(baseline.ttftMs[key] > 0) || !(measured.ttftMs[key] > 0)) throw new Error('baseline_samples_missing');
    ratios[key] = measured.ttftMs[key] / baseline.ttftMs[key];
  }
  return { schemaVersion: 1, baselineSha: baseline.sha, measuredSha: measured.sha,
    ttftRatios: ratios, provisionalTtftBudgetPass: ratios.p50 <= 1.1 && ratios.p95 <= 1.1,
    observationsValid: baseline.transportPass && measured.transportPass,
    releaseQualified: false, note: 'TTFT-only comparison; real overlap, browser, recovery and resource evidence still required.' };
}

/** Incremental SSE parser, capped independently of server behavior. */
export class Frames {
  buffer = '';
  push(text) {
    this.buffer += text;
    if (this.buffer.length > 2 * 1024 * 1024) throw new Error('frame_limit');
    const frames = [];
    let match;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const lines = block.split(/\r?\n/);
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const payload = JSON.parse(data);
      const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
      // Match the classic browser parser: the global response interceptor can
      // move type/data/durable id into JSON and leave auto-numbered wire IDs.
      frames.push({ type: eventName || payload.type || 'message',
        id: typeof payload.id === 'string' ? payload.id : lines.find(line => line.startsWith('id:'))?.slice(3).trim(),
        data: eventName ? payload : payload.data ?? payload });
    }
    return frames;
  }
}

export function validate(config, environment = process.env) {
  if (config.isolated !== true) throw new Error('isolated_environment_required');
  if (![10, 30].includes(config.users) || ![1, 2, 5].includes(config.tabs)) throw new Error('invalid_workload');
  if (!Array.isArray(config.replicas) || config.replicas.length !== 2 || new Set(config.replicas).size !== 2) throw new Error('two_direct_replica_urls_required');
  for (const address of config.replicas) {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid_replica_url');
  }
  if (!Array.isArray(config.identities) || config.identities.length !== config.users) throw new Error('identity_count');
  for (const field of ['userId', 'conversationId', 'tokenEnv']) {
    if (new Set(config.identities.map(identity => identity[field])).size !== config.users) throw new Error(`distinct_${field}_required`);
  }
  for (const identity of config.identities) {
    if (!/^[a-f0-9]{24}$/i.test(identity.userId) || !/^[a-f0-9]{24}$/i.test(identity.conversationId)) throw new Error('invalid_fixture_id');
    if (!/^[A-Z][A-Z0-9_]*$/.test(identity.tokenEnv) || !environment[identity.tokenEnv]) throw new Error('missing_identity_token');
    // Identity assertion is validated again by each real authenticated endpoint.
    let claims;
    try { claims = JSON.parse(Buffer.from(environment[identity.tokenEnv].split('.')[1], 'base64url').toString()); } catch { throw new Error('invalid_access_token'); }
    if (claims.sub !== identity.userId || !Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now() + (config.deadlineMs ?? 180000) + 30000) throw new Error('identity_token_subject_or_expiry');
    if (identity.allowedConversationIds && (!Array.isArray(identity.allowedConversationIds) || identity.allowedConversationIds.length > 20 ||
        identity.allowedConversationIds.some(id => !/^[a-f0-9]{24}$/i.test(id)))) throw new Error('invalid_owned_history_allowlist');
  }
  if (!Array.isArray(config.prompts) || !config.prompts.length || config.prompts.some(prompt => typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000)) throw new Error('prompts_required');
  for (const key of ['model', 'dataset', 'hardware', 'deployment', 'baselineSha']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`missing_${key}`);
  }
  if (!Number.isInteger(config.deadlineMs ?? 180000) || (config.deadlineMs ?? 180000) < 10000 || (config.deadlineMs ?? 180000) > 600000) throw new Error('invalid_deadline');
}

export async function benchmark(config) {
  validate(config);
  // Actor streams legitimately replay other owned fixture conversations. Never
  // trust an input allowlist alone: authorize every additional ID before using it.
  await Promise.all(config.identities.flatMap((identity, index) => (identity.allowedConversationIds ?? [])
    .filter(id => id !== identity.conversationId).map(async id => {
      const response = await fetch(`${config.replicas[index % 2]}/conversations/${id}`, {
        headers: { Authorization: `Bearer ${process.env[identity.tokenEnv]}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('owned_history_authorization_failed');
      await response.body?.cancel();
    })));
  const startedAt = new Date().toISOString();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  const start = performance.now();
  const controller = new AbortController();
  const aborted = new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
  const deadline = setTimeout(() => controller.abort(), config.deadlineMs ?? 180000);
  const states = config.identities.map(() => ({ sentAt: null, messageId: null, active: false, completed: false,
    tabs: Array.from({ length: config.tabs }, () => ({ connected: false, complete: false, chunks: 0, cursors: new Set(), lastCursor: 0n })) }));
  let active = 0, peakObservedStreams = 0;
  const counters = { foreign: 0, otherAuthorizedConversationEvents: 0, reordered: 0, duplicate: 0, resync: 0, streamErrors: 0, completedTabs: 0, connections: 0 };
  const sendStatuses = {};
  const ttft = [], delivery = [], backendPreparation = [], backendForwarding = [], adkPreProvider = [];
  const adapterIntervals = [];
  const failures = new Set();
  const ready = [];
  const streams = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  for (let user = 0; user < config.users; user++) {
    const identity = config.identities[user];
    for (let tab = 0; tab < config.tabs; tab++) {
      let resolveReady, rejectReady;
      ready.push(new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }));
      const task = (async () => {
        const response = await fetch(`${config.replicas[(user + tab) % 2]}/conversations/stream`, {
          headers: { Authorization: `Bearer ${process.env[identity.tokenEnv]}` }, signal: controller.signal,
        });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('sse_open_failed');
        const parser = new Frames(), decoder = new TextDecoder(), state = states[user], pipe = state.tabs[tab];
        for await (const bytes of response.body) {
          for (const frame of parser.push(decoder.decode(bytes, { stream: true }))) {
            const now = performance.now();
            if (frame.type === 'connected') { pipe.connected = true; counters.connections++; resolveReady(); continue; }
            if (frame.type === 'error') { counters.streamErrors++; throw new Error('stream_error'); }
            if (frame.type === 'stream_resync_required') { counters.resync++; continue; }
            const data = frame.data;
            if (data.conversationId && data.conversationId !== identity.conversationId) {
              if (identity.allowedConversationIds?.includes(data.conversationId)) counters.otherAuthorizedConversationEvents++;
              else counters.foreign++;
              continue;
            }
            // Ignore retained history; pin the current turn using stream_start or POST response.
            if (state.sentAt === null) continue;
            if (frame.type === 'stream_start' && !state.messageId) state.messageId = data.messageId;
            if (!state.messageId || data.messageId !== state.messageId) continue;
            if (['stream_start', 'stream_chunk', 'stream_complete', 'stream_error'].includes(frame.type) && !frame.id) throw new Error('missing_durable_cursor');
            if (frame.id) {
              if (!/^pg:1:\d+$/.test(frame.id)) throw new Error('invalid_durable_cursor');
              const cursor = BigInt(frame.id.split(':')[2]);
              if (pipe.cursors.has(frame.id)) counters.duplicate++;
              else if (cursor <= pipe.lastCursor) counters.reordered++;
              pipe.lastCursor = cursor; pipe.cursors.add(frame.id);
              if (pipe.cursors.size > 100000) throw new Error('event_limit');
            }
            if (frame.type === 'stream_start' && !state.active && !state.completed) {
              state.active = true; peakObservedStreams = Math.max(peakObservedStreams, ++active);
            }
            if (frame.type === 'stream_chunk') {
              pipe.chunks++;
              if (data.latency) {
                if (tab === 0) {
                  ttft.push(now - state.sentAt);
                  const metrics = data.latency.metrics ?? {};
                  if (Number.isFinite(metrics.backendPreAdkMs)) backendPreparation.push(metrics.backendPreAdkMs);
                  if (Number.isFinite(metrics.backendForwardingMs)) backendForwarding.push(metrics.backendForwardingMs);
                  if (Number.isFinite(metrics.adkPreProviderMs)) adkPreProvider.push(metrics.adkPreProviderMs);
                  if (data.latency.quality === 'ok' &&
                      [metrics.backendForwardingMs, metrics.adkForwardingMs, metrics.providerTtftMs].every(value => Number.isFinite(value) && value >= 0) &&
                      Number.isFinite(data.latency.backendFirstDeltaWrittenEpochMs)) {
                    const firstDelta = data.latency.backendFirstDeltaWrittenEpochMs - metrics.backendForwardingMs - metrics.adkForwardingMs;
                    adapterIntervals.push([firstDelta - metrics.providerTtftMs, firstDelta]);
                  }
                }
                const elapsed = Date.now() - data.latency.backendFirstDeltaWrittenEpochMs;
                if (Number.isFinite(elapsed) && elapsed >= 0) delivery.push(elapsed);
              }
            }
            if (frame.type === 'error' || frame.type === 'stream_error') { counters.streamErrors++; throw new Error('stream_error'); }
            if (frame.type === 'stream_complete' && !pipe.complete) {
              if (!pipe.chunks || !(data.usage?.outputTokens > 0)) throw new Error('real_generation_evidence_missing');
              pipe.complete = true; counters.completedTabs++;
              if (!state.completed) { state.completed = true; if (state.active) { active--; state.active = false; } }
              if (counters.completedTabs === config.users * config.tabs) resolveDone();
            }
          }
        }
        if (!controller.signal.aborted) throw new Error('unexpected_disconnect');
      })().catch(error => {
        // Fixed codes only: never stringify fetch/driver diagnostics or tokens.
        if (!controller.signal.aborted) { failures.add(['sse_open_failed', 'event_limit', 'stream_error', 'real_generation_evidence_missing', 'invalid_durable_cursor', 'missing_durable_cursor', 'unexpected_disconnect', 'frame_limit'].includes(error.message) ? error.message : 'transport_failed'); rejectReady(new Error('stream_not_ready')); resolveDone(); }
      });
      streams.push(task);
    }
  }
  try {
    await Promise.race([Promise.all(ready), aborted.then(() => { throw new Error('deadline'); })]);
    const sends = await Promise.allSettled(config.identities.map(async (identity, index) => {
      states[index].sentAt = performance.now();
      const response = await fetch(`${config.replicas[(index + 1) % 2]}/conversations/${identity.conversationId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env[identity.tokenEnv]}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: config.prompts[index % config.prompts.length], requestId: randomUUID() }), signal: controller.signal,
      });
      sendStatuses[response.status] = (sendStatuses[response.status] ?? 0) + 1;
      if (response.status !== 201) {
        await response.body?.cancel();
        throw new Error('send_failed');
      }
      const body = await response.json();
      const messageId = (body.data ?? body).aiMessageId;
      if (!messageId || (states[index].messageId && states[index].messageId !== messageId)) throw new Error('turn_identity_mismatch');
      states[index].messageId = messageId;
    }));
    if (sends.some(result => result.status === 'rejected')) throw new Error('send_failed');
    await Promise.race([done, aborted]);
  } catch { failures.add('request_or_readiness_failed'); }
  finally { clearTimeout(deadline); controller.abort(); await Promise.all(streams); }
  // Closing an SSE reader does not stop model work. Use fresh bounded signals.
  const cleanup = { stopped: 0, unresolved: 0 };
  await Promise.all(states.map(async (state, index) => {
    // HTTP status alone cannot prove pre-dispatch failure. An observed turn
    // must be stopped even if its POST failed; unknown acceptance stays unresolved.
    if (state.completed || state.sentAt === null) return;
    if (!state.messageId) { cleanup.unresolved++; return; }
    const identity = config.identities[index];
    try {
      const response = await fetch(`${config.replicas[(index + 1) % 2]}/conversations/${identity.conversationId}/messages/${state.messageId}/stop`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env[identity.tokenEnv]}` }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) { cleanup.unresolved++; return; }
      await response.body?.cancel();
      cleanup.stopped++;
    } catch { cleanup.unresolved++; }
  }));
  if (cleanup.unresolved) failures.add('unresolved_generation_cleanup');
  if (peakObservedStreams < config.users) failures.add('insufficient_observed_stream_overlap');
  if (counters.completedTabs !== config.users * config.tabs) failures.add('incomplete_generations');
  if (ttft.length !== config.users) failures.add('missing_latency_envelopes');
  if (counters.foreign || counters.reordered || counters.streamErrors) failures.add('delivery_contract_failed');
  let tabCursorMismatch = 0;
  for (const state of states) {
    if (state.tabs.some(tab => tab.cursors.size === 0)) failures.add('missing_tab_cursor_evidence');
    const canonical = [...state.tabs[0].cursors].sort().join(',');
    for (const tab of state.tabs.slice(1)) if ([...tab.cursors].sort().join(',') !== canonical) tabCursorMismatch++;
  }
  if (tabCursorMismatch) failures.add('tab_event_mismatch');
  return { schemaVersion: 1, startedAt, durationMs: performance.now() - start,
    sha: revision, sourceDirty: dirty,
    workload: { users: config.users, tabs: config.tabs, replicas: 2, model: config.model, dataset: config.dataset,
      deployment: config.deployment, hardware: config.hardware, baselineSha: config.baselineSha,
      promptDigest: createHash('sha256').update(JSON.stringify(config.prompts)).digest('hex') },
    driver: { host: hostname(), platform: platform(), cpus: cpus().length, memoryBytes: totalmem(), node: process.version },
    counters, sendStatuses, peakObservedStreams, cleanup, realGenerationOverlapVerified: false, tabCursorMismatch, ttftMs: distribution(ttft),
    adkAdapterOverlap: { samples: adapterIntervals.length, peak: peakIntervalOverlap(adapterIntervals),
      source: 'existing first-model latency trace; adapter invocation to first model delta',
      scope: 'includes adapter/provider pipeline; does not prove external provider execution concurrency',
      intervalsEpochMs: adapterIntervals },
    firstModelEventEmissionToReceiveMs: distribution(delivery), backendPreparationMs: distribution(backendPreparation),
    backendForwardingMs: distribution(backendForwarding), adkPreProviderMs: distribution(adkPreProvider),
    failures: [...failures], transportPass: failures.size === 0,
    releaseQualified: false,
    missingEvidence: ['authoritative concurrent model/provider execution intervals', 'all-event emission-to-browser delivery', 'browser first-paint and long tasks', 'PG CPU/connections/locks/plans and growth', 'replica identities and resource series', 'baseline TTFT comparison', 'PG outage and graceful/ungraceful kill recovery', 'canonical persisted-event loss reconciliation'],
  };
}

async function main() {
  const [configPath, outputPath, mode] = process.argv.slice(2);
  if (configPath === '--compare') {
    const [baselinePath, measuredPath, resultPath] = process.argv.slice(3);
    if (!baselinePath || !measuredPath || !resultPath) throw new Error('compare_arguments');
    const result = compare(JSON.parse(await readFile(baselinePath, 'utf8')), JSON.parse(await readFile(measuredPath, 'utf8')));
    await writeFile(resultPath, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    if (!result.observationsValid || !result.provisionalTtftBudgetPass) process.exitCode = 1;
    return;
  }
  if (!configPath || !outputPath || !['--validate', '--run'].includes(mode)) throw new Error('usage: node scripts/benchmark-classic-conversation-sse.mjs CONFIG OUTPUT --validate|--run');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  validate(config);
  const result = mode === '--run' ? await benchmark(config) : { configurationValid: true, releaseQualified: false };
  await writeFile(outputPath, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  if (mode === '--run' && !result.transportPass) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Classic SSE benchmark failed; check configuration, credentials, output path and isolated deployment.\n'); process.exitCode = 1; });
}
