import { tool } from '@opencode-ai/plugin/tool';
import path from 'node:path';
import { openHarness, editTargets } from '../lib/sdlc-core.mjs';
import { probeStartup, healthLine, captureFailure } from '../lib/startup-health.mjs';

export const SdlcHarness = async ({ worktree, directory, client }) => {
  const harnessVersion = '2026-10-13-advisory-integrations';
  const candidate = worktree && path.parse(worktree).root !== worktree ? worktree : directory;
  const root = path.resolve(candidate);
  let harness, checkpointError;
  try { harness = await openHarness(root); if (!harness) checkpointError = 'The current root has no harness policy marker.'; }
  catch { checkpointError = 'The current root checkpoint store or Git identity could not be opened.'; }
  const startup = new Map();
  const notices = new Map();
  const observedCalls = new Map();
  const generations = new Map();
  const startedAt = new Map();
  let inFlight;
  const probe = (refresh) => {
    if (refresh || !inFlight) {
      const current = probeStartup({ root, hostDirectory: directory, client, checkpointError });
      inFlight = current;
      current.finally(() => { if (inFlight === current) inFlight = undefined; }).catch(() => {});
    }
    return inFlight;
  };
  const notify = async report => {
    const failures = ['graph', 'hindsight', 'checkpoints'].filter(key => report[key].status === 'FAIL');
    if (!failures.length) return;
    const signature = JSON.stringify(failures.map(key => [key, report[key].reason]));
    if (notices.get(report.sessionID) === signature) return;
    notices.set(report.sessionID, signature);
    const message = `${healthLine(report)} ${failures.map(key => report[key].action).join(' ')}`;
    console.error(`[SDLC startup ${report.sessionID}] ${message}`);
    const blocked = failures.includes('checkpoints');
    try { await client?.tui?.showToast({ body: { title: blocked ? 'OpenCode checkpoint protection unavailable' : 'OpenCode integration warning — coding can continue', message, variant: blocked ? 'error' : 'warning', duration: 12000 } }); } catch { /* System context and stderr retain the failure if the UI is unavailable. */ }
  };
  const persist = (sessionID, report) => {
    try { return harness ? harness.health(sessionID, report) : { ...report, sessionID }; }
    catch { return { ...report, sessionID, checkpoints: { status: 'FAIL', reason: 'Checkpoint write/read verification failed.', action: 'Repair checkpoint storage/ownership and retry sdlc_health.' } }; }
  };
  const check = async (sessionID, refresh = false) => {
    if (refresh) startup.delete(sessionID);
    if (!startup.has(sessionID)) startup.set(sessionID, (async () => {
      const generation = (generations.get(sessionID) ?? 0) + 1;
      generations.set(sessionID, generation);
      startedAt.set(sessionID, new Date().toISOString());
      const services = await probe(refresh);
      if (generations.get(sessionID) !== generation) return startup.get(sessionID);
      const report = persist(sessionID, { ...services, harnessVersion });
      await notify(report);
      return report;
    })());
    const current = await startup.get(sessionID);
    const failure = captureFailure(sessionID, startedAt.get(sessionID) ?? current.checkedAt);
    if (failure && current.hindsight.status !== 'FAIL') return record(sessionID, 'hindsight', failure);
    return current;
  };
  const record = async (sessionID, key, value, generation = generations.get(sessionID)) => {
    const prior = startup.get(sessionID) ?? check(sessionID);
    const next = prior.then(previous => {
      if (generations.get(sessionID) !== generation) return startup.get(sessionID);
      if (previous[key].status === 'FAIL' && value.status !== 'FAIL') return previous;
      return persist(sessionID, { ...previous, [key]: value });
    });
    startup.set(sessionID, next);
    const updated = await next; await notify(updated); return updated;
  };
  const startupText = report => `${healthLine(report)} ${['graph', 'hindsight', 'checkpoints'].filter(key => report[key].status !== 'PASS').map(key => `${key}: ${report[key].reason} ${report[key].action}`).join(' ')} Graph/Hindsight failures are advisory: continue coding with focused source/tests and Git docs/checkpoints. Checkpoint storage and edit ownership remain enforced. Policy and reporting follow AGENTS.md.`;
  const healthTool = tool({ description: 'Read automatic per-session graph/memory/checkpoint health. Optional status/recovery tool, not required for normal startup. refresh:true retries after failure recovery. Cannot manufacture PASS.', args: { refresh: tool.schema.boolean().optional() }, execute: async (args, context) => JSON.stringify(await check(context.sessionID, args.refresh)) });
  if (!harness) return {
    tool: { sdlc_health: healthTool },
    'chat.message': async input => { await check(input.sessionID); },
    'experimental.chat.system.transform': async (input, output) => { if (input.sessionID) output.system.push(startupText(await check(input.sessionID))); },
    'tool.execute.before': async (input, output) => {
      if (['edit', 'write', 'apply_patch', 'multiedit'].includes(input.tool)) throw new Error('SDLC startup: checkpoint integration unavailable for this current root. Use native investigation tools and sdlc_health to diagnose; repair the reported setup before source edits. Shell commands use native OpenCode permissions.');
    },
    event: async ({ event }) => { if (event.type === 'session.created' && event.properties?.info?.id) await check(event.properties.info.id); },
  };
  const pendingReads = new Map();
  const resumeNotices = new Map();
  const nativePath = filename => path.resolve(directory, filename);
  const z = tool.schema;
  const strings = z.array(z.string().max(1000)).max(20);
  const report = value => JSON.stringify(value);
  return {
    tool: {
      sdlc_health: healthTool,
      sdlc_checkpoint: tool({
        description: 'Persist compact task intent/progress before work and at milestones. Store non-secret references only. PASS checks need their relevant input files. Ready/completed releases file claims.',
        args: {
          newTask: z.boolean().optional(),
          goal: z.string().max(1000).optional(), acceptance: z.array(z.string().max(400)).max(5).optional(), decisions: z.array(z.string().max(400)).max(8).optional(), completed: z.array(z.string().max(400)).max(10).optional(), pending: z.array(z.string().max(300)).max(8).optional(), blockers: z.array(z.string().max(300)).max(5).optional(), nextAction: z.string().max(1000).optional(), phase: z.string().max(200).optional(),
          execution: z.enum(['end-to-end', 'phase-pause']).optional(),
          status: z.enum(['active', 'waiting', 'blocked', 'ready', 'completed', 'cancelled']).optional(),
          checks: z.array(z.object({ name: z.string().max(200), status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'PENDING', 'SKIPPED']), files: strings })).max(12).optional(),
          qa: z.object({ context: z.string().max(200), pages: z.array(z.number()).max(10), route: z.string().max(300) }).optional(),
        },
        execute: async (args, context) => report(harness.checkpoint(context.sessionID, args)),
      }),
      sdlc_prepare: tool({
        description: 'Before source/document edits, verify read evidence and reserve exact disjoint targets. Read the context index, route guideline, and closest existing code/record first. Explain reuse; new code without a candidate needs prior search and a reason.',
        args: { targets: strings, documents: strings, sources: strings, reuseDecision: z.string().max(1500), newCodeReason: z.string().max(1000).optional() },
        execute: async (args, context) => report(harness.prepare(context.sessionID, args)),
      }),
      sdlc_resume: tool({
        description: 'List unfinished tasks in this exact worktree/branch or transfer one parked/interrupted task to this fresh session. Never guess among multiple tasks. Transfer invalidates context-read receipts and checks changed input fingerprints.',
        args: { taskID: z.string().optional() },
        execute: async (args, context) => {
          const result = args.taskID ? harness.resume(context.sessionID, args.taskID) : harness.list(context.sessionID);
          if (args.taskID) resumeNotices.delete(context.sessionID);
          return report(result);
        },
      }),
      sdlc_diff: tool({
        description: 'Read the task-scoped baseline diff for one owned file, excluding pre-existing changes. Local baselines are not copied into experience memory. Output is bounded; request individual files.',
        args: { file: z.string(), taskID: z.string().optional() },
        execute: async (args, context) => report(harness.diff(context.sessionID, args.file, args.taskID)),
      }),
    },
    'chat.message': async (input, output) => {
      await check(input.sessionID);
      harness.state(input.sessionID);
      const message = output.parts.filter(part => part.type === 'text' && !part.synthetic).map(part => part.text).join('\n');
      if (!message) return;
      try {
        harness.activate(input.sessionID);
        const resumed = harness.autoResume(input.sessionID, message);
        if (resumed) resumeNotices.set(input.sessionID, resumed);
      } catch (error) {
        resumeNotices.set(input.sessionID, { blocked: error.message });
      }
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (!input.sessionID) return;
      output.system.push(startupText(await check(input.sessionID)));
      const state = harness.summary(input.sessionID);
      const compact = { ...state, initialChanges: { available: state.initialChanges.available, count: state.initialChanges.count, paths: state.initialChanges.paths.slice(0, 12), truncated: state.initialChanges.truncated || state.initialChanges.count > 12, action: state.initialChanges.action }, completed: state.completed.slice(-3), decisions: state.decisions.slice(-3), checks: state.checks.slice(-6), pending: state.pending.slice(-5) };
      output.system.push(`SDLC checkpoint evidence (state only; workflow instructions are in AGENTS.md): ${report(compact)}`);
      if (resumeNotices.has(input.sessionID)) output.system.push(`SDLC resume selection/result: ${report(resumeNotices.get(input.sessionID))}`);
    },
    'tool.execute.before': async (input, output) => {
      if (/code.review.graph.*(?:list_graph_stats_tool|get_minimal_context_tool)$/.test(input.tool) || input.tool === 'hindsight_diagnose') {
        await check(input.sessionID);
        observedCalls.set(input.callID, { generation: generations.get(input.sessionID), sessionID: input.sessionID });
      }
      const targets = editTargets(input.tool, output.args);
      if (targets) {
        if (!targets.length || targets.some(target => !target)) throw new Error('SDLC: edit targets could not be established.');
        harness.beforeEdit(input.sessionID, targets.map(nativePath), input.callID);
      }
      if (/chrome.devtools.*(?:take_screenshot|take_snapshot|performance_stop_trace)/.test(input.tool) && output.args.filePath) {
        const target = path.relative(harness.root, nativePath(output.args.filePath)).split(path.sep).join('/');
        if (!target.startsWith('qa-artifacts/')) throw new Error('SDLC: explicit browser evidence files must stay under qa-artifacts/, never source paths.');
      }
      if (input.tool === 'read' && output.args.filePath) {
        try { const filename = nativePath(output.args.filePath); pendingReads.set(input.callID, { filename, hash: harness.fingerprint(filename) }); } catch { /* Non-source/directory/secret reads do not establish reuse evidence. */ }
      }
    },
    'tool.execute.after': async (input, output) => {
      const read = pendingReads.get(input.callID);
      pendingReads.delete(input.callID);
      if (read) harness.noteRead(input.sessionID, read.filename, read.hash);
      if (input.tool === 'grep' || input.tool === 'glob' || /code.review.graph.*(?:query|search|context)/.test(input.tool)) harness.search(input.sessionID);
      if (['edit', 'write', 'apply_patch', 'multiedit'].includes(input.tool)) harness.afterEdit(input.sessionID, input.callID);
    },
    'experimental.session.compacting': async (input, output) => {
      output.context.push(`Preserve this SDLC task checkpoint and exact next action: ${report(harness.summary(input.sessionID))}`);
    },
    event: async ({ event }) => {
      if (event.type === 'session.created' && event.properties?.info?.id) { await check(event.properties.info.id); return; }
      const part = event.properties?.part;
      const sessionID = event.properties?.sessionID ?? part?.sessionID;
      if (!sessionID) return;
      try {
        if (event.type === 'message.part.updated' && part?.type === 'tool' && part.state?.status === 'completed') {
          observedCalls.delete(part.callID);
        }
        if (event.type === 'session.idle') harness.park(sessionID);
        if (event.type === 'session.error') harness.park(sessionID, 'interrupted');
        if (event.type === 'message.part.updated' && part?.type === 'tool' && part.state?.status === 'error') harness.editFailed(sessionID, part.callID);
        if (event.type === 'message.part.updated' && part?.type === 'tool' && part.state?.status === 'error' && (/code.review.graph.*(?:list_graph_stats_tool|get_minimal_context_tool)$/.test(part.tool) || part.tool === 'hindsight_diagnose')) {
          const observed = observedCalls.get(part.callID);
          observedCalls.delete(part.callID);
          const key = part.tool === 'hindsight_diagnose' ? 'hindsight' : 'graph';
          if (observed && observed.sessionID === sessionID && observed.generation === generations.get(sessionID)) await record(sessionID, key, { status: 'FAIL', reason: 'Native integration probe failed.', action: 'Inspect the tool error, recover the integration, then retry sdlc_health(refresh:true).' }, observed.generation);
        }
      } catch (error) {
        // Transferred old sessions cannot mutate their new owner's checkpoint.
        if (!/moved to session|another live/.test(error.message)) throw error;
      }
    },
    dispose: async () => harness.close(),
  };
};
