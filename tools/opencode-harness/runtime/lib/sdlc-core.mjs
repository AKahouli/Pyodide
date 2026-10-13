import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const terminal = new Set(['completed', 'cancelled']);
const hash = value => createHash('sha256').update(value).digest('hex');
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const redactCheck = value => {
  const text = JSON.stringify(value);
  if (text.length > 24000) throw new Error('Keep checkpoints compact (maximum 24 KB).');
  if (/Bearer\s+[\w.+/-]{12,}|\bsk-[\w-]{12,}|(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["']?[^\s"',}]{4,}/i.test(text)) {
    throw new Error('Checkpoint contains a possible credential. Use non-secret references only.');
  }
};

export async function openHarness(directory, options = {}) {
  const root = realpathSync(directory);
  const policyPath = path.join(root, 'tools/opencode-harness/policy.json');
  if (!existsSync(policyPath)) return null;
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  const store = path.join(root, '.opencode/sdlc');
  mkdirSync(store, { recursive: true });
  if (path.relative(root, realpathSync(store)).startsWith('..')) throw new Error('Checkpoint storage must stay inside its worktree, not a shared symlink.');
  const filename = path.join(store, 'checkpoints.sqlite');
  let db, createDatabase;
  if (process.versions.bun) {
    const { Database } = await import('bun:sqlite');
    createDatabase = () => new Database(filename, { create: true, strict: true });
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    createDatabase = () => new DatabaseSync(filename);
  }
  // WAL negotiation can return SQLITE_BUSY immediately despite busy_timeout
  // when several processes create the same database at once. Retry only this
  // bounded bootstrap; permission/corruption errors remain explicit failures.
  const startupDeadline = performance.now() + 5000;
  const lockTimeout = () => {
    const remaining = Math.floor(startupDeadline - performance.now());
    if (remaining <= 0) throw new Error('Checkpoint initialization exhausted its 5-second lock budget. Check concurrent checkpoint writers and retry startup health.');
    db.exec(`PRAGMA busy_timeout=${remaining};`);
  };
  for (;;) {
    try {
      db = createDatabase();
      lockTimeout();
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      lockTimeout();
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, task TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS claims(path TEXT PRIMARY KEY, task TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS baselines(task TEXT NOT NULL, path TEXT NOT NULL, content BLOB, fingerprint TEXT, PRIMARY KEY(task,path));
        COMMIT;`);
      db.exec('PRAGMA busy_timeout=5000;');
      break;
    } catch (error) {
      db?.close(); db = undefined;
      const busy = [5, 6].includes(Number(error.errcode) & 255) || ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error.code);
      if (!busy) throw error;
      if (performance.now() >= startupDeadline) throw new Error('Checkpoint initialization exhausted its 5-second lock budget. Check concurrent checkpoint writers and retry startup health.', { cause: error });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const pid = options.pid ?? process.pid;
  const owner = randomUUID();
  const query = sql => db.prepare(sql);
  const transaction = operation => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const marker = path.join(root, '.git');
  const gitDirectory = statSync(marker).isDirectory() ? realpathSync(marker) : path.resolve(root, readFileSync(marker, 'utf8').trim().replace(/^gitdir:\s*/, ''));
  const commonMarker = path.join(gitDirectory, 'commondir');
  const commonDirectory = existsSync(commonMarker) ? path.resolve(gitDirectory, readFileSync(commonMarker, 'utf8').trim()) : gitDirectory;
  const identity = () => {
    const head = readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return { root, head, branch: 'HEAD' };
    const ref = head.slice(5);
    for (const folder of [gitDirectory, commonDirectory]) {
      const loose = path.join(folder, ref);
      if (existsSync(loose)) return { root, head: readFileSync(loose, 'utf8').trim(), branch: ref.replace(/^refs\/heads\//, '') };
    }
    const packed = path.join(commonDirectory, 'packed-refs');
    const entry = existsSync(packed) && readFileSync(packed, 'utf8').split('\n').find(line => line.endsWith(` ${ref}`));
    if (!entry) throw new Error('Cannot resolve the committed HEAD; initialize/repair this Git worktree before coding.');
    return { root, head: entry.split(' ')[0], branch: ref.replace(/^refs\/heads\//, '') };
  };
  const relative = filename => {
    const absolute = path.resolve(root, filename);
    let existing = absolute;
    while (!existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Path has no existing parent.');
      existing = parent;
    }
    const resolved = path.join(realpathSync(existing), path.relative(existing, absolute));
    const local = path.relative(root, resolved);
    if (!local || local.startsWith('..') || path.isAbsolute(local)) throw new Error('File must be inside this worktree.');
    const normalized = local.split(path.sep).join('/');
    if (normalized.split('/').some(part => part === '.git' || part === '.opencode' || /^\.env(?:\.|$)/i.test(part))) {
      throw new Error('Git internals, checkpoint storage and environment secrets are not edit/context targets.');
    }
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  // Resolve against the real path on Windows; relative keys are case-insensitive there.
  const fileHash = filename => {
    const absolute = path.join(root, filename);
    return existsSync(absolute) ? hash(readFileSync(absolute)) : null;
  };
  const taskById = id => {
    const row = query('SELECT data FROM tasks WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  };
  const initialChanges = () => {
    let status;
    try { status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true }); }
    catch { return { available: false, count: null, paths: [], truncated: true, action: 'Inspect Git status before claiming full review scope; exact target baselines are still captured.' }; }
    const entries = status.split('\0');
    const changes = [];
    for (let index = 0; index < entries.length; index++) {
      if (!entries[index]) continue;
      const entry = { status: entries[index].slice(0, 2), path: entries[index].slice(3) };
      if (/[RC]/.test(entry.status)) entry.previousPath = entries[++index];
      changes.push(entry);
    }
    return { available: true, count: changes.length, paths: changes.slice(0, 100), truncated: changes.length > 100 };
  };
  const save = task => {
    task.updatedAt = new Date().toISOString();
    query('INSERT INTO tasks(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(task.id, JSON.stringify(task));
  };
  const create = (sessionID, id = sessionID) => {
    const task = { version: 1, id, sessionID, owner: { pid, token: owner }, ...identity(), initialChanges: initialChanges(), status: 'new', goal: '', acceptance: [], decisions: [], completed: [], checks: [], pending: [], blockers: [], nextAction: '', execution: 'end-to-end', reads: {}, prepared: {}, searches: 0, files: {}, inFlight: null };
    save(task);
    query('INSERT INTO sessions(id,task) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET task=excluded.task').run(sessionID, task.id);
    return task;
  };
  const ensure = sessionID => {
    const binding = query('SELECT task FROM sessions WHERE id=?').get(sessionID);
    return binding ? taskById(binding.task) : create(sessionID);
  };
  const owned = sessionID => {
    const task = ensure(sessionID);
    if (task.sessionID !== sessionID) throw new Error(`Task ${task.id} moved to session ${task.sessionID}; continue there.`);
    if (task.owner.token !== owner && alive(task.owner.pid)) throw new Error(`Task ${task.id} is owned by another live OpenCode process.`);
    if (task.owner.token !== owner) {
      task.recovery = { interruptedOperation: task.inFlight, needsReconciliation: true };
      task.inFlight = null;
      task.reads = {};
      task.prepared = {};
    }
    task.owner = { pid, token: owner };
    return task;
  };
  const invalidateChecks = task => {
    const head = identity().head;
    return task.checks.map(check => ({ ...check, status: check.head === head && Object.entries(check.fingerprints ?? {}).every(([file, expected]) => fileHash(file) === expected) ? check.status : 'HISTORICAL' }));
  };
  const summary = task => ({
    id: task.id, ownerSession: task.sessionID, status: task.status, root, branch: task.branch, head: task.head,
    goal: task.goal, acceptance: task.acceptance, execution: task.execution, phase: task.phase,
    decisions: task.decisions.slice(-5), completed: task.completed.slice(-5), nextAction: task.nextAction,
    checks: invalidateChecks(task).map(({ name, status, files }) => ({ name, status, files })),
    pending: task.pending, blockers: task.blockers, modifiedFiles: Object.keys(task.files), initialChanges: task.initialChanges, recovery: task.recovery, reviewGaps: task.reviewGaps ?? [], qa: task.qa,
  });
  const candidates = sessionID => {
    const current = identity();
    return query('SELECT data FROM tasks').all().map(row => JSON.parse(row.data)).filter(task => task.id !== ensure(sessionID).id && task.goal && !terminal.has(task.status) && task.branch === current.branch).map(task => ({ id: task.id, goal: task.goal, status: task.status, nextAction: task.nextAction, active: Boolean(task.inFlight && alive(task.owner.pid)) }));
  };

  const api = {
    root, filename,
    health(sessionID, value) {
      return transaction(() => {
        const task = owned(sessionID);
        if (value === undefined) {
          const receipt = task.startupHealth?.[sessionID];
          return receipt?.root === root && receipt.sessionID === sessionID && receipt.processID === pid && receipt.ownerToken === owner ? receipt : null;
        }
        redactCheck(value);
        const service = name => {
          const item = value[name];
          if (!item || !['PASS', 'PENDING', 'FAIL'].includes(item.status)) throw new Error(`Startup health requires an explicit ${name} status.`);
          return { status: item.status, reason: String(item.reason ?? '').slice(0, 1500), action: String(item.action ?? '').slice(0, 1500) };
        };
        const receipt = { root, sessionID, processID: pid, ownerToken: owner, checkedAt: new Date().toISOString(), probe: randomUUID(), checkpoints: { status: 'PASS', reason: 'Transactional checkpoint write/read verified in this worktree.' }, graph: service('graph'), hindsight: service('hindsight') };
        if (value.harnessVersion) receipt.harnessVersion = String(value.harnessVersion).slice(0, 100);
        task.startupHealth = { ...(task.startupHealth ?? {}), [sessionID]: receipt };
        save(task);
        const stored = taskById(task.id)?.startupHealth?.[sessionID];
        if (JSON.stringify(stored) !== JSON.stringify(receipt)) throw new Error('Checkpoint startup health write/read verification failed. Repair local checkpoint storage before editing.');
        return stored;
      });
    },
    requireHealthy(sessionID) {
      if (!options.requireStartupHealth) return;
      const receipt = api.health(sessionID);
      if (!receipt) throw new Error('Session startup health has not been verified for this OpenCode process and worktree. Run the startup checks before editing.');
      const failed = ['checkpoints', 'graph', 'hindsight'].filter(name => receipt[name]?.status !== 'PASS');
      if (failed.length) throw new Error(`Session startup health blocks edits: ${failed.map(name => `${name} ${receipt[name]?.status ?? 'PENDING'}: ${receipt[name]?.reason || 'verification missing'}${receipt[name]?.action ? ` Action: ${receipt[name].action}` : ''}`).join('; ')}`);
      return receipt;
    },
    state(sessionID) { return transaction(() => ensure(sessionID)); },
    activate(sessionID) { transaction(() => { const task = owned(sessionID); if (task.goal && !terminal.has(task.status)) task.status = 'active'; save(task); }); },
    list(sessionID) { return transaction(() => candidates(sessionID)); },
    checkpoint(sessionID, input) {
      redactCheck(input);
      return transaction(() => {
        let task = owned(sessionID);
        if (input.newTask) {
          if (task.inFlight) throw new Error('Finish the in-flight edit before starting another task.');
          if (!terminal.has(task.status) && task.status !== 'ready') task.status = 'waiting';
          save(task);
          const startupHealth = task.startupHealth;
          task = create(sessionID, `${sessionID}-${randomUUID().slice(0, 8)}`);
          task.startupHealth = startupHealth;
        }
        const allowed = ['goal', 'acceptance', 'decisions', 'completed', 'pending', 'blockers', 'nextAction', 'execution', 'phase', 'qa', 'status'];
        for (const key of allowed) if (input[key] !== undefined) task[key] = input[key];
        if (input.checks) task.checks = input.checks.map(check => {
          const files = check.files.map(relative);
          if (!files.length) throw new Error('A check needs input files to establish freshness.');
          return { name: check.name, status: check.status, files, fingerprints: Object.fromEntries(files.map(file => [file, fileHash(file)])), head: identity().head };
        });
        if (terminal.has(task.status) || task.status === 'ready') {
          query('DELETE FROM claims WHERE task=?').run(task.id);
          task.prepared = {};
        }
        save(task);
        return { taskID: task.id, status: task.status, saved: true };
      });
    },
    noteRead(sessionID, filename, expectedHash) {
      return transaction(() => {
        const task = owned(sessionID);
        const file = relative(filename);
        const current = fileHash(file);
        if (current && current === expectedHash) task.reads[file] = current;
        save(task);
      });
    },
    fingerprint(filename) { return fileHash(relative(filename)); },
    search(sessionID) { transaction(() => { const task = owned(sessionID); task.searches++; save(task); }); },
    prepare(sessionID, input) {
      api.requireHealthy(sessionID);
      redactCheck(input);
      return transaction(() => {
        const task = owned(sessionID);
        if (!task.goal || !task.acceptance.length || !task.nextAction) throw new Error('Call sdlc_checkpoint with goal, acceptance criteria and nextAction first.');
        const targets = input.targets.map(relative);
        if (!targets.length) throw new Error('Specify exact owned edit targets.');
        const documents = input.documents.map(relative);
        const sources = input.sources.map(relative);
        const required = new Set([relative(policy.documentationIndex)]);
        for (const target of targets) for (const route of policy.documentationRoutes) {
          if (target.startsWith(relative(route.prefix + '__route_marker__').replace(/__route_marker__$/, ''))) required.add(relative(route.document));
        }
        for (const document of required) if (!documents.includes(document)) throw new Error(`Read and include required documentation: ${document}`);
        for (const file of [...documents, ...sources]) {
          const current = fileHash(file);
          if (!current || task.reads[file] !== current) throw new Error(`Use Read on current relevant sections before preparing: ${file}`);
        }
        if (!input.reuseDecision?.trim()) throw new Error('Explain the closest implementation/record and how it will be reused.');
        if (!sources.length && !(task.searches > 0 && input.newCodeReason?.trim())) throw new Error('Read an existing reuse candidate; if none exists, search first and explain why new code is necessary.');
        const evidence = Object.fromEntries([...documents, ...sources].map(file => [file, fileHash(file)]));
        for (const file of targets) {
          const current = fileHash(file);
          if (current && task.reads[file] !== current) throw new Error(`Read the existing target before editing: ${file}`);
          const claim = query('SELECT task FROM claims WHERE path=?').get(file);
          if (claim && claim.task !== task.id) throw new Error(`File ${file} belongs to task ${claim.task}; use disjoint files or another worktree.`);
          task.prepared[file] = { expected: fileHash(file), evidence, reuseDecision: input.reuseDecision, newCodeReason: input.newCodeReason ?? '' };
          const baseline = query('SELECT fingerprint FROM baselines WHERE task=? AND path=?').get(task.id, file);
          if (baseline && current !== (task.files[file] ?? baseline.fingerprint)) task.reviewGaps = [...new Set([...(task.reviewGaps ?? []), file])];
          if (!baseline) {
            const content = existsSync(path.join(root, file)) ? readFileSync(path.join(root, file)) : null;
            if (content && content.length > 2 * 1024 * 1024) throw new Error('Edit target is larger than the 2 MB local baseline limit. Split the task or use a dedicated artifact workflow.');
            query('INSERT INTO baselines(task,path,content,fingerprint) VALUES(?,?,?,?)').run(task.id, file, content ? gzipSync(content) : null, current);
          }
          query('INSERT INTO claims(path,task) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET task=excluded.task').run(file, task.id);
        }
        task.status = 'active';
        save(task);
        return { taskID: task.id, prepared: targets, evidenceVerified: true };
      });
    },
    beforeEdit(sessionID, filenames, callID) {
      api.requireHealthy(sessionID);
      return transaction(() => {
        const task = owned(sessionID);
        if (terminal.has(task.status)) throw new Error('Task is completed/cancelled; start a new task before editing.');
        const files = filenames.map(relative);
        for (const file of files) {
          const prepared = task.prepared[file];
          if (!prepared) throw new Error(`Before editing ${file}, read relevant docs/code and call sdlc_prepare with a reuse decision.`);
          if (fileHash(file) !== prepared.expected) throw new Error(`File ${file} changed outside this task. Read it and prepare again.`);
          for (const [source, expected] of Object.entries(prepared.evidence)) {
            if (fileHash(source) !== expected) throw new Error(`Context ${source} changed. Read current sections and prepare again.`);
          }
          const claim = query('SELECT task FROM claims WHERE path=?').get(file);
          if (claim?.task !== task.id) throw new Error(`Task no longer owns ${file}; prepare ownership again.`);
        }
        if (task.inFlight) throw new Error('Another source edit is still in flight for this task.');
        task.inFlight = { callID, files, before: Object.fromEntries(files.map(file => [file, fileHash(file)])) };
        task.status = 'active';
        save(task);
      });
    },
    afterEdit(sessionID, callID) {
      transaction(() => {
        const task = owned(sessionID);
        if (task.inFlight?.callID !== callID) return;
        for (const file of task.inFlight.files) {
          const current = fileHash(file);
          task.files[file] = current;
          task.prepared[file].expected = current;
          task.reads[file] = current;
          for (const prepared of Object.values(task.prepared)) if (file in prepared.evidence) prepared.evidence[file] = current;
        }
        task.inFlight = null;
        save(task);
      });
    },
    editFailed(sessionID, callID) {
      transaction(() => {
        const task = owned(sessionID);
        if (task.inFlight?.callID !== callID) return;
        task.recovery = { interruptedOperation: task.inFlight, needsReconciliation: true };
        task.inFlight = null;
        task.prepared = {};
        save(task);
      });
    },
    park(sessionID, status = 'waiting') {
      transaction(() => { const task = owned(sessionID); if (!terminal.has(task.status) && task.status !== 'ready') task.status = status; save(task); });
    },
    resume(sessionID, taskID) {
      return transaction(() => {
        const provisional = owned(sessionID);
        if (provisional.goal && provisional.id !== taskID) throw new Error('This session already owns another task; open a fresh session to resume.');
        const task = taskById(taskID);
        if (!task || terminal.has(task.status)) throw new Error('Checkpoint is missing or already finished.');
        if (task.root !== root || task.branch !== identity().branch) throw new Error('Checkpoint belongs to a different worktree/branch.');
        if (task.sessionID !== sessionID && (task.inFlight || task.status === 'active') && alive(task.owner.pid)) throw new Error('The original task is active. Interrupt/park it before transferring ownership.');
        const previousSession = task.sessionID;
        // Only the destination session's current-process checks remain valid.
        task.startupHealth = { ...(task.startupHealth ?? {}), ...(provisional.startupHealth ?? {}) };
        task.sessionID = sessionID;
        task.owner = { pid, token: owner };
        task.checks = invalidateChecks(task);
        task.reads = {};
        task.prepared = {};
        task.status = 'active';
        task.recovery = { previousSession, interruptedOperation: task.inFlight, needsReconciliation: Object.entries(task.files).some(([file, expected]) => fileHash(file) !== expected) };
        task.inFlight = null;
        if (task.qa) task.qa = { ...task.qa, runtimeVerified: false };
        query('INSERT INTO sessions(id,task) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET task=excluded.task').run(sessionID, task.id);
        if (provisional.id !== task.id) query('DELETE FROM tasks WHERE id=?').run(provisional.id);
        save(task);
        return summary(task);
      });
    },
    summary(sessionID) {
      return transaction(() => summary(ensure(sessionID)));
    },
    diff(sessionID, filename, taskID) {
      const task = transaction(() => taskID ? taskById(taskID) : ensure(sessionID));
      if (!task || task.root !== root) throw new Error('Review task does not belong to this worktree.');
      const file = relative(filename);
      if (task.reviewGaps?.includes(file) || (file in task.files && fileHash(file) !== task.files[file])) throw new Error('This file also changed outside the task. Exact review scope needs reconciliation; do not present a combined diff as task-only.');
      const baseline = query('SELECT content FROM baselines WHERE task=? AND path=?').get(task.id, file);
      if (!baseline) throw new Error('This file has no task baseline; unrelated changes are outside review scope.');
      const temporary = path.join(store, `diff-${randomUUID()}`);
      const current = temporary + '-current';
      writeFileSync(temporary, baseline.content ? gunzipSync(baseline.content) : '');
      writeFileSync(current, existsSync(path.join(root, file)) ? readFileSync(path.join(root, file)) : '');
      try {
        let result;
        try { result = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', temporary, current], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); }
        catch (error) { if (error.status !== 1) throw error; result = error.stdout.toString(); }
        return { file, diff: result.slice(0, 12000), truncated: result.length > 12000 };
      } finally { unlinkSync(temporary); unlinkSync(current); }
    },
    autoResume(sessionID, message) {
      const explicit = message.trim().match(/^resume\s+task\s+([\w-]+)\s*[.!]?$/i);
      if (explicit) return api.resume(sessionID, explicit[1]);
      if (!/^(?:resume|continue)(?:\s+(?:the\s+)?(?:previous|last|interrupted)\s+(?:task|session))?[.!]?$/i.test(message.trim())) return null;
      const available = api.list(sessionID);
      return available.length === 1 ? api.resume(sessionID, available[0].id) : { resumeCandidates: available, action: available.length ? 'Ask which task to resume, once.' : 'No unfinished task matches this worktree/branch.' };
    },
    shellAllowed(sessionID, command) {
      // Source writes use guarded edit tools. This is a workflow gate, not an OS sandbox for test/build scripts.
      if (/[;&|<>\r\n`$]/.test(command) || /--output(?:=|\s)|\s-e(?:\s|$)|--eval|pathspec-from-file/i.test(command)) return false;
      const readOnly = /^\s*(?:git\s+(?:status|diff|log|show|rev-parse|symbolic-ref)\b|(?:pwd|Get-Location)\s*$)/i.test(command);
      if (readOnly) return true;
      // Focused diagnosis must remain available to reproduce a defect and
      // recover an integration. Trusted test scripts are not an OS sandbox.
      const diagnostic = /^\s*(?:npm\s+(?:test\b|run\s+(?:test(?::[\w-]+)?|lint|typecheck)\b)|npx\s+(?:vitest|jest|tsc|playwright\s+test)\b|conda\s+run\s+-n\s+meta\s+pytest\b|node\s+scripts\/observability\/(?:check-policy|run-gates)\.mjs\b)/i.test(command);
      if (diagnostic) return true;
      api.requireHealthy(sessionID);
      if (!api.state(sessionID).goal) return false;
      return /^\s*(?:git\s+(?:add|commit)\b|npm\s+(?:test\b|run\s+(?:test(?::[\w-]+)?|lint|build|typecheck|dev|start(?::[\w-]+)?)\b)|npx\s+(?:vitest|jest|tsc|playwright\s+test)\b|conda\s+run\s+-n\s+meta\s+pytest\b|node\s+scripts\/observability\/(?:check-policy|run-gates)\.mjs\b)/i.test(command);
    },
    close() {
      transaction(() => {
        for (const row of query('SELECT data FROM tasks').all()) {
          const task = JSON.parse(row.data);
          if (task.owner.token !== owner) continue;
          task.owner.pid = 0;
          if (!terminal.has(task.status) && task.status !== 'ready') task.status = 'interrupted';
          save(task);
        }
      });
      db.close();
    },
  };
  return api;
}

export function editTargets(tool, args) {
  if (tool === 'edit' || tool === 'write') return [args.filePath];
  if (tool === 'multiedit') return args.edits.map(edit => edit.filePath);
  if (tool === 'apply_patch') {
    const patch = args.patchText ?? args.patch ?? '';
    return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map(match => (match[1] ?? match[2]).trim());
  }
  return null;
}
