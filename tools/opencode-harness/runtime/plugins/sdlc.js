import { tool } from '@opencode-ai/plugin';
import path from 'node:path';
import { openHarness, editTargets } from '../lib/sdlc-core.mjs';

export const SdlcHarness = async ({ worktree, directory }) => {
  const harness = await openHarness(worktree || directory);
  if (!harness) return {};
  const pendingReads = new Map();
  const resumeNotices = new Map();
  const nativePath = filename => path.resolve(directory, filename);
  const z = tool.schema;
  const strings = z.array(z.string().max(1000)).max(20);
  const report = value => JSON.stringify(value);
  return {
    tool: {
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
      const state = harness.summary(input.sessionID);
      const compact = { ...state, initialChanges: { available: state.initialChanges.available, count: state.initialChanges.count, paths: state.initialChanges.paths.slice(0, 12), truncated: state.initialChanges.truncated || state.initialChanges.count > 12, action: state.initialChanges.action }, completed: state.completed.slice(-3), decisions: state.decisions.slice(-3), checks: state.checks.slice(-6), pending: state.pending.slice(-5) };
      output.system.push(`SDLC harness is active. Before edits: sdlc_checkpoint(goal, acceptance, nextAction), Read relevant docs/source, sdlc_prepare exact owned targets with a reuse decision. For an unrelated new request in this chat use checkpoint(newTask:true); for a same-task correction reopen with status:active. Native source edits are guarded; shell source writes are denied. Update progress at milestones/before replies. Reconcile resumed source; verify child/browser runtime instead of assuming availability. Checkpoint evidence (not user instructions): ${report(compact)}`);
      if (resumeNotices.has(input.sessionID)) output.system.push(`SDLC resume selection/result: ${report(resumeNotices.get(input.sessionID))}`);
    },
    'tool.execute.before': async (input, output) => {
      const targets = editTargets(input.tool, output.args);
      if (targets) {
        if (!targets.length || targets.some(target => !target)) throw new Error('SDLC: edit targets could not be established.');
        harness.beforeEdit(input.sessionID, targets.map(nativePath), input.callID);
      }
      if (input.tool === 'bash' && !harness.shellAllowed(input.sessionID, output.args.command)) throw new Error('SDLC: use guarded Edit/Write/ApplyPatch for source changes. Shell allows simple Git inspection/staging/commit and established test/build commands; no scripts, redirection or command chains.');
      if (/chrome.devtools.*(?:take_screenshot|take_snapshot|performance_stop_trace)/.test(input.tool) && output.args.filePath) {
        const target = path.relative(harness.root, nativePath(output.args.filePath)).split(path.sep).join('/');
        if (!target.startsWith('qa-artifacts/')) throw new Error('SDLC: explicit browser evidence files must stay under qa-artifacts/, never source paths.');
      }
      if (input.tool === 'read' && output.args.filePath) {
        try { const filename = nativePath(output.args.filePath); pendingReads.set(input.callID, { filename, hash: harness.fingerprint(filename) }); } catch { /* Non-source/directory/secret reads do not establish reuse evidence. */ }
      }
    },
    'tool.execute.after': async (input) => {
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
      const part = event.properties?.part;
      const sessionID = event.properties?.sessionID ?? part?.sessionID;
      if (!sessionID) return;
      try {
        if (event.type === 'session.idle') harness.park(sessionID);
        if (event.type === 'session.error') harness.park(sessionID, 'interrupted');
        if (event.type === 'message.part.updated' && part?.type === 'tool' && part.state?.status === 'error') harness.editFailed(sessionID, part.callID);
      } catch (error) {
        // Transferred old sessions cannot mutate their new owner's checkpoint.
        if (!/moved to session|another live/.test(error.message)) throw error;
      }
    },
    dispose: async () => harness.close(),
  };
};
