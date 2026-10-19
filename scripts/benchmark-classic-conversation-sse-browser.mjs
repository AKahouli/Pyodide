#!/usr/bin/env node
// One real user/tab, not browser capacity qualification. Never persist browser state,
// traces, HAR, screenshots, response text, credentials or driver diagnostics.
import { readFile, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = 'http://127.0.0.1:3301/api/v1';
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Detached final outcome: late browser operations cannot change emitted evidence. */
export function finalizeBrowserReport(report, expired) {
  const final = structuredClone(report);
  if (expired) { final.smokePass = false; final.code = 'deadline'; }
  return Object.freeze(final);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    runDirectory: { type: 'string' }, frontendOrigin: { type: 'string' }, output: { type: 'string' }, channel: { type: 'string' },
  } });
  const run = await realpath(path.resolve(root, values.runDirectory ?? positionals[0] ?? ''));
  const tmp = await realpath(path.join(root, '.tmp'));
  if (path.dirname(run) !== tmp || !/^pr06-local-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path.basename(run))) throw new Error('invalid_run');
  const origin = new URL(values.frontendOrigin ?? positionals[1] ?? 'http://localhost:5173');
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.port !== '5173' ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid_frontend');
  const frontend = origin.origin;
  const output = path.resolve(run, values.output ?? positionals[2] ?? 'browser-smoke.json');
  if (await realpath(path.dirname(output)) !== run || path.extname(output) !== '.json') throw new Error('invalid_output');
  // Open exclusively before spending model quota; never overwrite seed/report files.
  const reportFile = await open(output, 'wx', 0o600);
  const report = { schemaVersion: 1, scope: 'one-user one-tab classic browser smoke', users: 1, tabs: 1,
    releaseQualified: false, missingEvidence: ['full_browser_matrix', 'baseline_comparison', 'recovery'],
    smokePass: false, code: 'setup_failed', blockedRequests: 0, paint: null, longtasks: null,
    cleanup: { required: false, stopped: false, unresolved: false } };
  let browser, context, page, timer, conversationId, messageId, finalReport;
  let submitted = false, completed = false, expired = false, stage = 'setup_failed';
  const active = () => { if (expired) throw new Error('deadline'); };
  const start = performance.now();
  // Only sanitized results cross back to Node; access tokens stay in the real
  // frontend module's memory. This dev-only import reads, never changes, its store.
  const browserApi = async (operation, extra = {}) => page.evaluate(async ({ api, operation, conversationId, messageId, ...extra }) => {
    const { getAccessToken } = await import('/src/lib/api/access-token-store.ts');
    const token = getAccessToken();
    if (!token) return { ok: false };
    let url = `${api}/conversations`, method = 'GET', body;
    if (operation === 'create') {
      method = 'POST'; body = JSON.stringify({ title: 'PR06 browser smoke', rootAgentId: extra.agentId });
    } else if (operation === 'stop') {
      url += `/${conversationId}/messages/${messageId}/stop`; method = 'POST';
    } else url += `/${conversationId}/messages/${messageId}`;
    const response = await fetch(url, { method, credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(operation === 'stop' ? 4500 : 8000) });
    if (!response.ok) return { ok: false };
    if (operation === 'stop') { await response.body?.cancel(); return { ok: true }; }
    const raw = await response.json(), data = raw.data ?? raw;
    return operation === 'create' ? { ok: true, id: data.id ?? data._id } : {
      ok: true, completed: data.terminalStatus === 'completed' && data.outputTokens > 0,
      failed: ['failed', 'cancelled', 'interrupted'].includes(data.terminalStatus),
    };
  }, { api, operation, conversationId, messageId, ...extra });
  try {
    const work = async () => {
      const seed = JSON.parse(await readFile(path.join(run, 'fixture-seed.json'), 'utf8'));
      const identity = seed.identities?.[0];
      if (!identity || !objectId(identity.userId) || !objectId(identity.agentId) ||
          typeof identity.email !== 'string' || !identity.email.endsWith('@example.invalid') ||
          !identity.email.includes(path.basename(run)) || typeof identity.password !== 'string' || !identity.password) throw new Error('fixture');
      const require = createRequire(path.join(root, 'YellowStorm', 'back', 'package.json'));
      const { chromium } = require('playwright');
      stage = 'browser_launch_failed';
      if (values.channel && !['chrome', 'chromium'].includes(values.channel)) throw new Error('channel');
      browser = await chromium.launch({ headless: true, timeout: 15000, channel: values.channel });
      report.browserVersion = browser.version();
      if (expired) { await browser.close(); throw new Error('deadline'); }
      context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
      if (expired) { await context.close(); throw new Error('deadline'); }
      context.setDefaultTimeout(10000);
      // No external sockets: Vite HMR is unnecessary for this read-only smoke.
      if (typeof context.routeWebSocket !== 'function') throw new Error('websocket_guard');
      await context.routeWebSocket('**/*', socket => { socket.close(); });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const asset = url.origin === frontend && ['GET', 'HEAD'].includes(request.method()) &&
          !/^\/(?:api|socket\.io)(?:\/|$)/.test(url.pathname);
        const isolated = url.origin === new URL(api).origin && url.pathname.startsWith('/api/v1/');
        if (!asset && !isolated) { report.blockedRequests++; await route.abort('blockedbyclient'); return; }
        if (url.origin === frontend && url.pathname === '/config.js') {
          await route.fulfill({ status: 200, contentType: 'application/javascript',
            body: `window.__APP_CONFIG__=${JSON.stringify({ API_URL: api, SOCKET_BASE_URL: new URL(api).origin })};` });
          return;
        }
        await route.continue();
      });
      await context.addInitScript(({ api }) => {
        window.__APP_CONFIG__ = { API_URL: api, SOCKET_BASE_URL: new URL(api).origin };
        localStorage.setItem('yellowmind:locale', 'en'); // Locale only; never a token.
        const state = { supported: PerformanceObserver.supportedEntryTypes.includes('longtask'), entries: [], start: null };
        window.__PR06_BROWSER_SMOKE__ = state;
        if (state.supported) {
          const observer = new PerformanceObserver(list => {
            for (const item of list.getEntries()) {
              if (state.entries.length < 10000) state.entries.push({ startTime: item.startTime, duration: item.duration });
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
          state.observer = observer;
        }
      }, { api });
      page = await context.newPage();
      active();
      // A fresh context has no other user's cookies, storage or pages.
      context.on('page', extra => { if (extra !== page) void extra.close().catch(() => {}); });
      stage = 'ui_login_failed';
      await page.goto(`${frontend}/#/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Login with email', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('input[type="email"]').fill(identity.email);
      await dialog.locator('input[type="password"]').fill(identity.password);
      const loginResponse = page.waitForResponse(r => r.url() === `${api}/auth/login` && r.request().method() === 'POST');
      await dialog.locator('button[type="submit"]').click();
      const login = await loginResponse;
      if (!login.ok()) throw new Error('login');
      // Assert the UI authenticated the intended fixture, without retaining its JWT.
      const loginBody = await login.json();
      if ((loginBody.data ?? loginBody).user?.id !== identity.userId) throw new Error('identity');
      await dialog.waitFor({ state: 'hidden' });
      active();
      stage = 'fresh_conversation_failed';
      const created = await browserApi('create', { agentId: identity.agentId });
      if (!created.ok || !objectId(created.id)) throw new Error('create');
      conversationId = created.id;
      active();
      // Hash navigation preserves the authenticated in-memory store.
      await page.evaluate(id => { location.hash = `/conversation/${id}`; }, conversationId);
      const composer = page.locator('[data-conversation-composer] textarea');
      await composer.waitFor({ state: 'visible' });
      stage = 'generation_or_paint_failed';
      const sendUrl = `${api}/conversations/${conversationId}/messages`;
      const sent = page.waitForResponse(r => r.url() === sendUrl && r.request().method() === 'POST');
      // Observe the application's real paint POST; never fabricate this endpoint.
      const painted = page.waitForResponse(r => r.request().method() === 'POST' &&
        r.url().startsWith(`${api}/conversations/${conversationId}/messages/`) && r.url().endsWith('/latency/frontend-paint'),
      { timeout: 90000 });
      // Attach handlers immediately so timeout/closing cannot emit secret-bearing diagnostics.
      void sent.catch(() => {}); void painted.catch(() => {});
      await composer.fill('Reply with one short friendly greeting. Do not use tools.');
      await page.evaluate(() => { window.__PR06_BROWSER_SMOKE__.start = performance.now(); });
      active();
      submitted = true;
      await composer.press('Enter');
      const response = await sent;
      const raw = await response.json();
      messageId = (raw.data ?? raw).aiMessageId;
      if (response.status() !== 201 || !objectId(messageId)) throw new Error('send');
      const paint = await painted;
      const payload = paint.request().postDataJSON();
      if (!paint.ok() || paint.url() !== `${sendUrl}/${messageId}/latency/frontend-paint` || payload.schemaVersion !== 1 ||
          !finite(payload.frontendFirstChunkPaintedEpochMs) || !finite(payload.frontendRenderMs) ||
          !finite(payload.browserRenderOnlyMs) || payload.quality !== 'ok') throw new Error('paint');
      report.paint = { status: paint.status(), schemaVersion: 1, frontendFirstChunkPaintedEpochMs: payload.frontendFirstChunkPaintedEpochMs,
        frontendRenderMs: payload.frontendRenderMs, browserRenderOnlyMs: payload.browserRenderOnlyMs };
      while (!completed) {
        active();
        const status = await browserApi('status');
        if (!status.ok || status.failed) throw new Error('generation');
        completed = status.completed;
        if (!completed) await page.waitForTimeout(500);
      }
      report.longtasks = await page.evaluate(() => {
        const state = window.__PR06_BROWSER_SMOKE__;
        for (const entry of state.observer?.takeRecords() ?? []) {
          if (state.entries.length < 10000) state.entries.push({ startTime: entry.startTime, duration: entry.duration });
        }
        const end = performance.now();
        const durations = state.entries.filter(e => e.startTime >= state.start && e.startTime <= end).map(e => e.duration).sort((a, b) => a - b);
        return { supported: state.supported, observationMs: end - state.start, count: durations.length,
          totalMs: durations.reduce((sum, d) => sum + d, 0), maxMs: durations.at(-1) ?? 0,
          p95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null,
          bufferLimitReached: state.entries.length >= 10000 };
      });
      if (!report.longtasks.supported || report.longtasks.bufferLimitReached) throw new Error('observer');
      active(); // A deadline during the final awaited evaluation is terminal.
      report.smokePass = true; report.code = 'ok';
    };
    await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; stage = 'deadline'; reject(new Error('deadline')); }, 90000);
    })]);
  } catch { report.code = stage; }
  finally {
    clearTimeout(timer);
    // An SSE/page close does not stop generation. Separate, fresh five-second
    // cleanup budget; report unknown acceptance rather than claiming cancellation.
    if (submitted && !completed) {
      report.cleanup.required = true;
      if (page && conversationId && messageId) {
        let stopTimer;
        try {
          const result = await Promise.race([browserApi('stop'), new Promise((_, reject) => {
            stopTimer = setTimeout(() => reject(new Error('stop_deadline')), 5000);
          })]);
          report.cleanup.stopped = result.ok === true;
        } catch { /* Fixed unresolved flag below, no private error output. */ }
        finally { clearTimeout(stopTimer); }
      }
      report.cleanup.unresolved = !report.cleanup.stopped;
    }
    try { await context?.close(); } catch { report.cleanup.contextCloseFailed = true; report.smokePass = false; }
    try { await browser?.close(); } catch { report.cleanup.browserCloseFailed = true; report.smokePass = false; }
    report.elapsedMs = Math.round(performance.now() - start);
    finalReport = finalizeBrowserReport(report, expired);
    try { await reportFile.writeFile(`${JSON.stringify(finalReport, null, 2)}\n`); } finally { await reportFile.close(); }
  }
  process.stdout.write(`classic_browser_smoke:${finalReport.smokePass ? 'PASS' : 'FAIL'}\n`);
  if (!finalReport.smokePass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('classic_browser_smoke:setup_failed\n'); process.exitCode = 1; });
}
