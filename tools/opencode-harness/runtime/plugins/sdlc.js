import { Plugin } from '@opencode/plugin';
import path from 'node:path';
import { openHarness } from '../lib/sdlc-core.mjs';
import { probeStartup, healthLine } from '../lib/startup-health.mjs';

const text = maxLength => ({ type: 'string', maxLength });
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const enumeration = values => ({ type: 'string', enum: values });

export default Plugin.define({
  id: 'yellowstorm.sdlc',
  async setup(ctx) {
    const harnessVersion = '2026-10-22-opencode-v2';
    const candidate = ctx.location.project.directory;
    const root = path.resolve(candidate && path.parse(candidate).root !== candidate ? candidate : ctx.location.directory);
    let harness, checkpointError;
    try { harness = await openHarness(root); if (!harness) checkpointError = 'The current root has no harness policy marker.'; }
    catch { checkpointError = 'The current root checkpoint store or Git identity could not be opened.'; }
    const startup = new Map();
    const notices = new Map();
    const observedCalls = new Map();
    const graphifyCalls = new Map();
    const generations = new Map();
    const resumeNotices = new Map();
    let inFlight;
    const probe = refresh => {
      if (refresh || !inFlight) {
        const current = probeStartup({ root, checkpointError });
        inFlight = current;
        current.finally(() => { if (inFlight === current) inFlight = undefined; }).catch(() => {});
      }
      return inFlight;
    };
    const notify = report => {
      const failures = ['graph', 'checkpoints'].filter(key => report[key].status === 'FAIL');
      if (!failures.length) return;
      const signature = JSON.stringify(failures.map(key => [key, report[key].reason]));
      if (notices.get(report.sessionID) === signature) return;
      notices.set(report.sessionID, signature);
      // V2 server plugins have no TUI toast API. Context and health tools retain this warning.
      console.error(`[SDLC startup ${report.sessionID}] ${healthLine(report)} ${failures.map(key => report[key].action).join(' ')}`);
    };
    const persist = (sessionID, report) => {
      const withCount = { ...report, graphifyInvocations: graphifyCalls.get(sessionID) ?? 0 };
      try { return harness ? harness.health(sessionID, withCount) : { ...withCount, sessionID }; }
      catch { return { ...withCount, sessionID, checkpoints: { status: 'FAIL', reason: 'Checkpoint write/read verification failed.', action: 'Checkpoint memory unavailable; continue coding and retry sdlc_health after recovery.' } }; }
    };
    const check = async (sessionID, refresh = false) => {
      if (refresh) startup.delete(sessionID);
      if (!startup.has(sessionID)) startup.set(sessionID, (async () => {
        const generation = (generations.get(sessionID) ?? 0) + 1;
        generations.set(sessionID, generation);
        const services = await probe(refresh);
        if (generations.get(sessionID) !== generation) return startup.get(sessionID);
        const report = persist(sessionID, { ...services, harnessVersion });
        notify(report);
        return report;
      })());
      return startup.get(sessionID);
    };
    const record = async (sessionID, key, value, generation) => {
      const prior = startup.get(sessionID) ?? check(sessionID);
      const next = prior.then(previous => {
        if (generations.get(sessionID) !== generation) return startup.get(sessionID);
        if (previous[key].status === 'FAIL' && value.status !== 'FAIL') return previous;
        return persist(sessionID, { ...previous, [key]: value });
      });
      startup.set(sessionID, next);
      const updated = await next; notify(updated);
    };
    const report = value => ({ content: JSON.stringify(value) });
    const startupText = value => `${healthLine(value)} ${['graph', 'checkpoints'].filter(key => value[key].status !== 'PASS').map(key => `${key}: ${value[key].reason} ${value[key].action}`).join(' ')} Graph failures are advisory: continue coding with focused source/tests and Git docs/checkpoints. Checkpoint failures are advisory and do not block editing. Policy and reporting follow AGENTS.md.`;
    await ctx.tool.transform(editor => {
      editor.add({
        name: 'sdlc_health',
        description: 'Read automatic per-session graph/checkpoint health. Optional recovery tool; refresh:true retries after recovery. Cannot manufacture PASS.',
        input: object({ refresh: { type: 'boolean' } }),
        execute: async (args, context) => report(await check(context.sessionID, args.refresh)),
      });
      if (!harness) return;
      editor.add({
        name: 'sdlc_checkpoint',
        description: 'Persist compact task intent/progress before work and at milestones. Store non-secret references only. PASS checks need their relevant input files. Editing never requires a checkpoint.',
        input: object({
          newTask: { type: 'boolean' }, goal: text(1000), acceptance: list(text(400), 5), decisions: list(text(400), 8), completed: list(text(400), 10), pending: list(text(300), 8), blockers: list(text(300), 5), nextAction: text(1000), phase: text(200),
          execution: enumeration(['end-to-end', 'phase-pause']),
          status: enumeration(['active', 'waiting', 'blocked', 'ready', 'completed', 'cancelled']),
          checks: list(object({ name: text(200), status: enumeration(['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'SKIPPED']), files: list(text(1000), 20) }, ['name', 'status', 'files']), 12),
          qa: object({ context: text(200), pages: list({ type: 'number' }, 10), route: text(300) }, ['context', 'pages', 'route']),
        }),
        execute: async (args, context) => report(harness.checkpoint(context.sessionID, args)),
      });
      editor.add({
        name: 'sdlc_resume',
        description: 'List unfinished tasks or create an independent continuation in this session. Current and source tasks are preserved. Never guess among multiple tasks. Recheck changed input fingerprints.',
        input: object({ taskID: { type: 'string' } }),
        execute: async (args, context) => {
          const result = args.taskID ? harness.resume(context.sessionID, args.taskID) : harness.list(context.sessionID);
          if (args.taskID) resumeNotices.delete(context.sessionID);
          return report(result);
        },
      });
    });
    await ctx.session.hook('prompt', async event => {
      await check(event.sessionID);
      if (!harness || !event.prompt.text) return;
      try {
        harness.activate(event.sessionID);
        const resumed = harness.autoResume(event.sessionID, event.prompt.text);
        if (resumed) resumeNotices.set(event.sessionID, resumed);
      } catch (error) { resumeNotices.set(event.sessionID, { blocked: error.message }); }
    });
    await ctx.session.hook('context', async event => {
      event.system.push({ type: 'text', text: startupText(await check(event.sessionID)) });
      if (!harness) return;
      let state;
      try { state = harness.summary(event.sessionID); }
      catch { event.system.push({ type: 'text', text: 'Checkpoint memory unavailable; continue normal coding.' }); return; }
      const compact = { ...state, initialChanges: { available: state.initialChanges.available, count: state.initialChanges.count, paths: state.initialChanges.paths.slice(0, 12), truncated: state.initialChanges.truncated || state.initialChanges.count > 12, action: state.initialChanges.action }, completed: state.completed.slice(-3), decisions: state.decisions.slice(-3), checks: state.checks.slice(-6), pending: state.pending.slice(-5) };
      event.system.push({ type: 'text', text: `SDLC checkpoint evidence (state only; workflow instructions are in AGENTS.md): ${JSON.stringify(compact)}` });
      if (resumeNotices.has(event.sessionID)) event.system.push({ type: 'text', text: `SDLC resume selection/result: ${JSON.stringify(resumeNotices.get(event.sessionID))}` });
    });
    if (harness) {
      await ctx.tool.hook('execute.before', async event => {
        if (event.tool !== 'shell' || !/^graphify\s/.test(String(event.input?.command ?? '').trimStart())) return;
        graphifyCalls.set(event.sessionID, (graphifyCalls.get(event.sessionID) ?? 0) + 1);
        const cached = await startup.get(event.sessionID);
        if (cached) startup.set(event.sessionID, Promise.resolve(persist(event.sessionID, cached)));
        await check(event.sessionID);
        observedCalls.set(event.id, { generation: generations.get(event.sessionID), sessionID: event.sessionID });
      });
      await ctx.tool.hook('execute.after', async event => {
        const observed = observedCalls.get(event.id);
        observedCalls.delete(event.id);
        if (event.status === 'error' && observed && observed.sessionID === event.sessionID && observed.generation === generations.get(event.sessionID)) {
          await record(event.sessionID, 'graph', { status: 'FAIL', reason: 'Graphify CLI query failed.', action: 'Inspect the command error, recover the graphify installation/index, then retry sdlc_health(refresh:true).' }, observed.generation);
        }
      });
      await ctx.session.hook('compaction', event => {
        try { event.system.push({ type: 'text', text: `Preserve this SDLC task checkpoint and exact next action: ${JSON.stringify(harness.summary(event.sessionID))}` }); } catch { /* Checkpoint memory is advisory. */ }
      });
    }
    const controller = new AbortController();
    const events = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const sessionID = event.data?.sessionID;
          if (event.type === 'session.created' && event.data.location?.directory && path.resolve(event.data.location.directory) === path.resolve(ctx.location.directory)) {
            await check(sessionID);
            continue;
          }
          // V2 subscriptions cover the shared server. Never park another location's sessions.
          if (!harness || !startup.has(sessionID)) continue;
          try {
            if (event.type === 'session.status' && event.data.status.type === 'idle') harness.park(sessionID);
            if (event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') harness.park(sessionID, 'interrupted');
          } catch { console.error('[SDLC] Checkpoint update unavailable; coding can continue.'); }
        }
      } catch { if (!controller.signal.aborted) console.error('[SDLC] Session event subscription unavailable; coding can continue.'); }
    })();
    return async () => { controller.abort(); await events; harness?.close(); };
  },
});
