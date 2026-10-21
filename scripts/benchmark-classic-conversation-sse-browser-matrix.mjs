#!/usr/bin/env node
// One bounded scenario, never a release qualification. No browser state, response
// text, credentials, traces, HAR, screenshots or driver errors are persisted.
import { readFile, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { finalizeBrowserReport } from './benchmark-classic-conversation-sse-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = 'http://localhost:5173';
const apis = [3301, 3302].map(port => `http://localhost:${port}/api/v1`);
const objectId = v => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const hash = v => createHash('sha256').update(v).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const workMs = 220000, stopMs = 5000, observationMs = 5000, closeMs = 10000;
const memoryFloorBytes = 2 * 1024 ** 3;
class PhaseFailure extends Error {
  constructor(code) { super('phase_failed'); this.code = code; }
}

export function validPaint(payload) {
  return payload?.schemaVersion === 1 && payload.quality === 'ok' &&
    ['frontendFirstChunkPaintedEpochMs', 'frontendRenderMs', 'browserRenderOnlyMs'].every(key => finite(payload[key]));
}

export function allowedRequest(raw, method) {
  const url = new URL(raw);
  if (url.username || url.password || !['http:'].includes(url.protocol)) return false;
  if (apis.some(api => url.origin === new URL(api).origin)) return url.pathname.startsWith('/api/v1/');
  return url.origin === frontend && ['GET', 'HEAD'].includes(method) &&
    !/^\/(?:api|socket\.io)(?:\/|$)/.test(url.pathname) &&
    (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/config.js' ||
      /^\/(?:src|node_modules|@vite|@react-refresh|@fs|@id|assets)\//.test(url.pathname) ||
      url.pathname === '/@react-refresh' || /\.(?:js|css|svg|png|ico|woff2?|ttf|webp)$/.test(url.pathname));
}

async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('bounded_timeout')), ms);
  })]); } finally { clearTimeout(timer); }
}

export async function guardedBrowserLaunch(active, launch) {
  active(); // No asynchronous gap between cancellation check and acquisition.
  return launch();
}

// Tokens are read only from the actual application's in-memory module, never
// returned to Node. Status/identity results cross the boundary sanitized.
async function pageApi(state, operation, agentId) {
  return state.pages[0].page.evaluate(async ({ api, operation, conversationId, messageId, agentId }) => {
    const { getAccessToken } = await import('/src/lib/api/access-token-store.ts');
    const token = getAccessToken();
    if (!token) return { ok: false };
    let url = `${api}/conversations`, method = 'GET', body;
    if (operation === 'identity') url = `${api}/users/me`;
    else if (operation === 'create') {
      method = 'POST'; body = JSON.stringify({ title: 'PR06 browser matrix', rootAgentId: agentId });
    } else {
      url += `/${conversationId}/messages/${messageId}`;
      if (operation === 'stop') { url += '/stop'; method = 'POST'; }
    }
    const response = await fetch(url, { method, credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(operation === 'stop' ? 4500 : 8000) });
    if (!response.ok) return { ok: false };
    if (operation === 'stop') { await response.body?.cancel(); return { ok: true }; }
    const raw = await response.json(), data = raw.data ?? raw;
    if (operation === 'create' || operation === 'identity') return { ok: true, id: data.id ?? data._id };
    return { ok: true, completed: data.terminalStatus === 'completed' && data.outputTokens > 0,
      outputTokens: Number.isFinite(data.outputTokens) ? data.outputTokens : 0,
      failed: ['failed', 'cancelled', 'interrupted'].includes(data.terminalStatus) };
  }, { api: state.pages[0].api, operation, conversationId: state.conversationId,
    messageId: state.messageId, agentId });
}

async function main() {
  const { values } = parseArgs({ options: { users: { type: 'string' }, tabs: { type: 'string' },
    runDirectory: { type: 'string' }, output: { type: 'string' }, channel: { type: 'string' } } });
  const users = Number(values.users), tabs = Number(values.tabs);
  // Playwright debug logging can include UI fill arguments. Refuse it rather
  // than risk writing a fixture password to inherited process diagnostics.
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('diagnostics_disabled');
  if (![10, 30].includes(users) || ![1, 2, 5].includes(tabs) || !values.runDirectory || !values.output ||
      !['chrome', 'chromium'].includes(values.channel ?? 'chrome')) throw new Error('arguments');
  const run = await realpath(path.resolve(root, values.runDirectory));
  if (path.dirname(run) !== await realpath(path.join(root, '.tmp')) ||
      !/^pr06-local-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path.basename(run))) throw new Error('run');
  const output = path.resolve(run, values.output);
  if (await realpath(path.dirname(output)) !== run || path.extname(output) !== '.json') throw new Error('output');
  const file = await open(output, 'wx', 0o600);
  const report = { schemaVersion: 1, scope: 'single real-browser classic conversation capacity scenario',
    users, tabs, releaseQualified: false, smokePass: false, code: 'private_inputs', blockedRequests: 0,
    missingEvidence: ['full six-scenario matrix', 'matched baseline', 'recovery', 'provider execution overlap',
      'real foreground/background capacity', 'full deployed frontend/backend artifact attestation'],
    launch: { channel: values.channel ?? 'chrome', headless: true, viewport: { width: 1280, height: 720 },
      customArgs: [], chromiumDefaultAutomationFlags: true, serviceWorkers: 'block', websocketPolicy: 'abort_all',
      visibilityQualification: 'Observed only; default Chromium automation may disable background throttling.' },
    budget: { workMs, stopMs, observationMs, closeMs, setupConcurrency: 5, longtaskEntryLimitPerPage: 10000 },
    hostMemory: { totalBytes: os.totalmem(), freeBytesAtStart: os.freemem(), floorBytes: memoryFloorBytes,
      minimumSampledFreeBytes: os.freemem(), sampleIntervalMs: 1000,
      scope: 'Host headroom samples, not isolated browser RSS or a capacity guarantee' },
    provenance: { apiOrigins: apis, frontendOrigin: frontend, sourceSHA: null, frontendSHA: null,
      frontendSHAScope: 'SHA256 of served Vite /src/modules/conversation/stream.ts only; not whole frontend' },
    proof: { uniqueUsers: 0, readyConnections: 0, refreshRestoredPages: 0, canonicalCompleted: 0,
      paintResponses: 0, expectedPages: users * tabs, longtaskLimitsExceeded: 0,
      readyScope: 'Successful real SSE response plus application connected-frame state at pre-send barrier' },
    pages: [], cleanup: { required: 0, stopped: 0, unresolved: 0, unknownAcceptance: 0, browserClosed: false } };
  let browser, launchPending = false, expired = false, stopped = false, cancelCode, timer, memoryTimer, stage = 'private_inputs';
  const states = [], contexts = new Set();
  const start = performance.now();
  const active = () => { if (expired || stopped) throw new PhaseFailure(cancelCode ?? (expired ? 'deadline' : 'inactive')); };
  try {
    const work = async () => {
      active();
      const seed = JSON.parse(await readFile(path.join(run, 'fixture-seed.json'), 'utf8'));
      const fixture = JSON.parse(await readFile(path.join(run, 'benchmark.json'), 'utf8'));
      if (fixture.isolated !== true || fixture.identities?.length !== 30 || !Array.isArray(seed.identities)) throw new Error('fixture');
      if (!Array.isArray(fixture.replicas) || fixture.replicas.length !== 2 || ![3301, 3302].every(port =>
        fixture.replicas.some(raw => {
          const url = new URL(raw);
          return ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:' &&
            url.port === String(port) && url.pathname === '/api/v1' && !url.username && !url.password && !url.search && !url.hash;
        }))) throw new Error('fixture_replicas');
      report.provenance.fixtureRun = path.basename(run);
      const byId = new Map(seed.identities.map(identity => [identity.userId, identity]));
      const identities = fixture.identities.slice(0, users).map(item => byId.get(item.userId));
      if (identities.some(identity => !identity || !objectId(identity.userId) || !objectId(identity.agentId) ||
          typeof identity.password !== 'string' || !identity.password || typeof identity.email !== 'string' ||
          !identity.email.endsWith('@example.invalid') || !identity.email.includes(path.basename(run))) ||
          new Set(identities.map(i => i.userId)).size !== users || new Set(identities.map(i => i.email)).size !== users ||
          byId.size !== seed.identities.length) throw new Error('fixture');
      report.provenance.sourceSHA = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 3000 })).stdout.trim();
      report.provenance.scriptSHA256 = hash(await readFile(fileURLToPath(import.meta.url)));
      report.provenance.helperSHA256 = hash(await readFile(path.join(root, 'scripts/benchmark-classic-conversation-sse-browser.mjs')));
      report.provenance.workingTreeDiffSHA256 = hash((await promisify(execFile)('git', ['diff', 'HEAD', '--', 'YellowStorm/front', 'YellowStorm/back'],
        { cwd: root, timeout: 3000, maxBuffer: 8 * 1024 * 1024 })).stdout);
      report.provenance.workingTreeDiffScope = 'tracked frontend/backend diff; excludes untracked and runtime artifact identity';
      stage = 'browser_launch_failed';
      const require = createRequire(path.join(root, 'YellowStorm/back/package.json'));
      const { chromium } = require('playwright');
      launchPending = true;
      try { browser = await guardedBrowserLaunch(active, () => chromium.launch({ headless: true, channel: report.launch.channel, timeout: 15000 })); }
      finally { launchPending = false; }
      if (expired || stopped) { void browser.close().catch(() => {}); active(); }
      report.browserVersion = browser.version();
      const setup = async (identity, user) => {
        active();
        const state = { user, identityId: identity.userId, pages: [], submitted: false, completed: false };
        states.push(state);
        state.phase = 'context_guard_failed';
        try {
        const context = await browser.newContext({ viewport: report.launch.viewport, serviceWorkers: 'block' });
        contexts.add(context);
        if (expired || stopped) { void context.close().catch(() => {}); active(); }
        context.setDefaultTimeout(15000);
        if (typeof context.routeWebSocket !== 'function') throw new Error('websocket_guard');
        await context.routeWebSocket('**/*', socket => { socket.close(); });
        const pageApis = new WeakMap();
        await context.route('**/*', async route => {
          const request = route.request();
          const ownedStop = stopped && request.method() === 'POST' && state.messageId &&
            request.url() === `${state.pages[0].api}/conversations/${state.conversationId}/messages/${state.messageId}/stop`;
          if (((expired || stopped) && !ownedStop) || !allowedRequest(request.url(), request.method())) {
            report.blockedRequests++; await route.abort('blockedbyclient'); return;
          }
          const url = new URL(request.url());
          if (url.origin === frontend && url.pathname === '/config.js') {
            const api = pageApis.get(request.frame().page());
            if (!api) { await route.abort(); return; }
            await route.fulfill({ status: 200, contentType: 'application/javascript',
              body: `window.__APP_CONFIG__=${JSON.stringify({ API_URL: api, SOCKET_BASE_URL: new URL(api).origin })};` });
          } else await route.continue();
        });
        for (let tab = 0; tab < tabs; tab++) {
          active();
          state.phase = tab ? 'refresh_restore_failed' : 'ui_login_failed';
          const page = await context.newPage(), api = apis[(user + tab) % 2];
          pageApis.set(page, api);
          page.on('popup', popup => { void popup.close().catch(() => {}); });
          const entry = { page, api, user, tab, ready: false, readyAtBarrier: false, paint: null, refresh: false };
          state.pages.push(entry);
          await page.addInitScript(({ api }) => {
            window.__APP_CONFIG__ = { API_URL: api, SOCKET_BASE_URL: new URL(api).origin };
            localStorage.setItem('yellowmind:locale', 'en');
            const state = { supported: PerformanceObserver.supportedEntryTypes.includes('longtask'), entries: [],
              start: null, dropped: false, visibility: [] };
            window.__PR06_MATRIX__ = state;
            const visibility = () => { if (state.visibility.length < 100) state.visibility.push({
              atMs: performance.now(), state: document.visibilityState }); };
            visibility(); document.addEventListener('visibilitychange', visibility);
            if (state.supported) {
              state.observer = new PerformanceObserver(list => {
                for (const item of list.getEntries()) {
                  if (state.entries.length < 10000) state.entries.push({ startTime: item.startTime, duration: item.duration });
                  else state.dropped = true;
                }
              });
              state.observer.observe({ type: 'longtask', buffered: true });
            }
          }, { api });
          page.on('response', response => {
            const url = response.url(), request = response.request();
            if (url.startsWith(`${api}/conversations/stream`) && response.ok() &&
                response.headers()['content-type']?.includes('text/event-stream')) entry.ready = true;
            if (url === `${api}/auth/refresh` && request.method() === 'POST' && response.ok()) entry.refresh = true;
            if (!state.conversationId || !url.startsWith(`${api}/conversations/${state.conversationId}/messages/`) ||
                !url.endsWith('/latency/frontend-paint') || request.method() !== 'POST') return;
            try {
              const payload = request.postDataJSON(), messageId = url.split('/').at(-3);
              if (!response.ok() || !objectId(messageId) || !validPaint(payload)) { entry.invalidPaint = true; return; }
              entry.paint = { messageId, status: response.status(), schemaVersion: 1,
                frontendFirstChunkPaintedEpochMs: payload.frontendFirstChunkPaintedEpochMs,
                frontendRenderMs: payload.frontendRenderMs, browserRenderOnlyMs: payload.browserRenderOnlyMs };
            } catch { entry.invalidPaint = true; }
          });
          if (!tab) {
            await page.goto(`${frontend}/#/`, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: 'Login with email', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.locator('input[type="email"]').fill(identity.email);
            await dialog.locator('input[type="password"]').fill(identity.password);
            const loggedIn = page.waitForResponse(r => r.url() === `${api}/auth/login` && r.request().method() === 'POST');
            void loggedIn.catch(() => {});
            await dialog.locator('button[type="submit"]').click();
            const response = await loggedIn, raw = await response.json();
            if (!response.ok() || (raw.data ?? raw).user?.id !== identity.userId) throw new Error('identity');
            await dialog.waitFor({ state: 'hidden' });
            active(); state.phase = 'fresh_conversation_failed';
            const result = await pageApi(state, 'create', identity.agentId);
            if (!result.ok || !objectId(result.id)) throw new Error('create');
            state.conversationId = result.id;
            await page.evaluate(id => { location.hash = `/conversation/${id}`; }, result.id);
          } else {
            // New tab has no memory token: production bootstrap restores the shared
            // HttpOnly cookie. No auth store writes or manufactured refresh call.
            await page.goto(`${frontend}/#/conversation/${state.conversationId}`, { waitUntil: 'domcontentloaded' });
          }
          await page.locator('[data-conversation-composer] textarea').waitFor({ state: 'visible' });
          const verified = await pageApi({ ...state, pages: [entry] }, 'identity');
          if (!verified.ok || verified.id !== identity.userId || (tab && !entry.refresh)) throw new Error('restore_identity');
          if (!tab) state.identityVerified = true;
          state.phase = 'sse_ready_failed';
          await page.waitForFunction(async () => {
            const { conversationStreamService } = await import('/src/modules/conversation/stream.ts');
            return conversationStreamService.getIsConnected();
          });
          if (!entry.ready) throw new Error('sse_response');
        }
        } catch { throw new PhaseFailure(state.phase); }
      };
      let next = 0;
      await Promise.all(Array.from({ length: 5 }, async () => {
        while (next < identities.length) { const user = next++; await setup(identities[user], user); }
      }));
      if (new Set(states.map(s => s.conversationId)).size !== users) throw new PhaseFailure('fresh_conversation_failed');
      active(); stage = 'frontend_provenance_failed';
      // Read-only, actual served transformed module: never an auth endpoint.
      const served = await states[0].pages[0].page.evaluate(async () => {
        const response = await fetch('/src/modules/conversation/stream.ts');
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      });
      if (!served) throw new Error('frontend_source');
      report.provenance.frontendSHA = served;
      report.proof.uniqueUsers = new Set(states.map(s => s.identityId)).size;
      report.proof.readyConnections = states.flatMap(s => s.pages).filter(p => p.ready).length;
      report.proof.refreshRestoredPages = states.flatMap(s => s.pages).filter(p => p.tab && p.refresh).length;
      stage = 'send_failed';
      // Prepare all composers before the common UI send barrier.
      await Promise.all(states.map(s => s.pages[0].page.locator('[data-conversation-composer] textarea')
        .fill('Reply with a short paragraph explaining why the sky appears blue.')));
      await Promise.all(states.flatMap(s => s.pages).map(p => p.page.evaluate(() => {
        window.__PR06_MATRIX__.start = performance.now();
        window.__PR06_MATRIX__.sendVisibility = document.visibilityState;
      })));
      stage = 'sse_ready_failed';
      await Promise.all(states.flatMap(s => s.pages).map(async p => {
        await p.page.waitForFunction(async () => {
          const { conversationStreamService } = await import('/src/modules/conversation/stream.ts');
          return conversationStreamService.getIsConnected();
        });
        p.readyAtBarrier = p.ready;
      }));
      stage = 'send_failed';
      active(); report.sendBarrierMs = Math.round(performance.now() - start);
      await Promise.all(states.map(async state => {
        active();
        const first = state.pages[0], url = `${first.api}/conversations/${state.conversationId}/messages`;
        const sent = first.page.waitForResponse(r => r.url() === url && r.request().method() === 'POST', { timeout: 30000 });
        void sent.catch(() => {});
        // Mark before UI action: if acceptance cannot be learned, cleanup must say unknown.
        state.submitted = true;
        await first.page.locator('[data-conversation-composer] textarea').press('Enter');
        const response = await sent, raw = await response.json();
        const id = (raw.data ?? raw).aiMessageId;
        if (response.status() !== 201 || !objectId(id)) throw new Error('send');
        state.messageId = id;
      }));
      stage = 'canonical_completion_failed';
      await Promise.all(states.map(async state => {
        while (!state.completed) {
          active(); const result = await pageApi(state, 'status');
          if (!result.ok || result.failed) throw new Error('canonical');
          state.completed = result.completed;
          if (state.completed) state.outputTokens = result.outputTokens;
          else await delay(500);
        }
      }));
      stage = 'paint_missing_or_unverified';
      const paintDeadline = performance.now() + 15000;
      while (!states.every(s => s.pages.every(p => p.paint?.messageId === s.messageId && !p.invalidPaint))) {
        active();
        if (performance.now() >= paintDeadline) throw new Error('paint_missing');
        await delay(200);
      }
      active(); report.smokePass = true; report.code = 'ok';
    };
    const headroom = new Promise((_, reject) => {
      const sample = () => {
        const free = os.freemem();
        report.hostMemory.minimumSampledFreeBytes = Math.min(report.hostMemory.minimumSampledFreeBytes, free);
        if (free < memoryFloorBytes) { cancelCode = 'host_memory_budget_stop'; stopped = true; reject(new PhaseFailure(cancelCode)); }
      };
      sample(); memoryTimer = setInterval(sample, 1000);
    });
    await Promise.race([work(), headroom, new Promise((_, reject) => {
      timer = setTimeout(() => { cancelCode = 'deadline'; expired = true; reject(new Error('deadline')); }, workMs);
    })]);
  } catch (error) {
    report.smokePass = false;
    report.failurePhase = error instanceof PhaseFailure ? error.code : stage;
    report.code = expired ? 'deadline' : report.failurePhase;
  }
  finally {
    stopped = true; clearTimeout(timer); clearInterval(memoryTimer);
    // All known unfinished turns stop concurrently under one independent budget.
    const unfinished = states.filter(s => s.submitted && !s.completed);
    report.cleanup.required = unfinished.length;
    report.cleanup.unknownAcceptance = unfinished.filter(s => !s.messageId).length;
    let cleanupOpen = true;
    try { await bounded(Promise.all(unfinished.filter(s => s.messageId).map(async state => {
      try { const result = await pageApi(state, 'stop'); if (cleanupOpen && result.ok) report.cleanup.stopped++; } catch { /* sanitized */ }
    })), stopMs); } catch { /* unresolved counted below */ }
    cleanupOpen = false;
    report.cleanup.unresolved = unfinished.length - report.cleanup.stopped;
    // Also collect visibility/observer evidence on failures, notably missing paint
    // in background pages. A bounded failed read remains explicitly unverified.
    const entries = states.flatMap(s => s.pages);
    const observations = new Map();
    let observationOpen = true;
    try { await bounded(Promise.all(entries.map(async entry => {
      try {
        const metrics = await entry.page.evaluate(() => {
          const state = window.__PR06_MATRIX__, end = performance.now();
          if (!state) return null;
          for (const item of state.observer?.takeRecords() ?? []) {
            if (state.entries.length < 10000) state.entries.push({ startTime: item.startTime, duration: item.duration });
            else state.dropped = true;
          }
          state.observer?.disconnect();
          const durations = state.entries.filter(e => state.start !== null && e.startTime >= state.start).map(e => e.duration).sort((a, b) => a - b);
          return { supported: state.supported, measurementStarted: state.start !== null,
            observationMs: state.start === null ? null : end - state.start, count: durations.length,
            totalMs: durations.reduce((a, b) => a + b, 0), maxMs: durations.at(-1) ?? 0,
            p95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null,
            bufferLimitReached: state.dropped || state.entries.length >= 10000,
            visibilityAtSend: state.sendVisibility, visibilityAtEnd: document.visibilityState,
            visibilityTransitions: state.visibility };
        });
        if (observationOpen) observations.set(entry, metrics);
      } catch { /* No driver error crosses the reporting boundary. */ }
    })), observationMs); } catch { /* Explicit null measurements below. */ }
    observationOpen = false;
    report.pages = entries.map(entry => ({ user: entry.user, tab: entry.tab, replicaPort: new URL(entry.api).port,
          ready: entry.readyAtBarrier, refreshRestored: entry.refresh, paint: entry.paint && {
            status: entry.paint.status, schemaVersion: 1, frontendFirstChunkPaintedEpochMs: entry.paint.frontendFirstChunkPaintedEpochMs,
            frontendRenderMs: entry.paint.frontendRenderMs, browserRenderOnlyMs: entry.paint.browserRenderOnlyMs },
          longtasks: observations.get(entry) ?? null }));
    report.observationScope = 'UI send barrier through collection; failed runs may include stop cleanup';
    if (report.pages.length !== users * tabs || report.pages.some(p => !p.longtasks?.supported ||
        !p.longtasks.measurementStarted || p.longtasks.bufferLimitReached)) {
      report.smokePass = false;
      if (report.code === 'ok') report.code = 'longtask_observation_failed';
    }
    try { await bounded((async () => {
      // Do not let a hung context close prevent the owned browser close attempt.
      for (const context of contexts) void context.close().catch(() => {});
      await browser?.close(); report.cleanup.browserClosed = !launchPending;
    })(), closeMs); } catch { report.cleanup.closeUnresolved = true; }
    if (report.cleanup.unresolved || !report.cleanup.browserClosed) { report.smokePass = false; if (report.code === 'ok') report.code = 'cleanup_unresolved'; }
    report.proof.canonicalCompleted = states.filter(s => s.completed && s.outputTokens > 0).length;
    report.proof.uniqueUsers = new Set(states.filter(s => s.identityVerified).map(s => s.identityId)).size;
    report.proof.readyConnections = states.flatMap(s => s.pages).filter(p => p.readyAtBarrier).length;
    report.proof.refreshRestoredPages = states.flatMap(s => s.pages).filter(p => p.tab && p.refresh).length;
    report.proof.paintResponses = states.flatMap(s => s.pages.filter(p => p.paint?.messageId === s.messageId && !p.invalidPaint)).length;
    report.proof.longtaskLimitsExceeded = report.pages.filter(p => p.longtasks?.bufferLimitReached).length;
    if (report.smokePass && (report.proof.uniqueUsers !== users || report.proof.readyConnections !== users * tabs ||
        report.proof.canonicalCompleted !== users || report.proof.paintResponses !== users * tabs ||
        report.proof.refreshRestoredPages !== users * (tabs - 1))) {
      report.smokePass = false; report.code = 'proof_incomplete';
    }
    report.canonical = states.filter(s => s.completed).map(s => ({ user: s.user, terminalStatus: 'completed', outputTokens: s.outputTokens }));
    report.elapsedMs = Math.round(performance.now() - start);
    report.hostMemory.freeBytesAtEnd = os.freemem();
    const final = finalizeBrowserReport(report, expired);
    try { await file.writeFile(`${JSON.stringify(final, null, 2)}\n`); } finally { await file.close(); }
    process.stdout.write(`classic_browser_matrix:${final.smokePass ? 'PASS' : 'FAIL'}:${final.code}\n`);
    if (!final.smokePass) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('classic_browser_matrix:setup_failed\n'); process.exitCode = 1; });
}
