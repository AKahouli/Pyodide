#!/usr/bin/env node
// Private inputs stay in memory; reports contain only benchmark measurements.
import { readFile, realpath, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { benchmark, validate } from './benchmark-classic-conversation-sse.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));

export async function matrix(runPath, outputPath) {
  const tmp = await realpath(path.join(root, '.tmp'));
  const run = await realpath(path.resolve(runPath));
  if (path.dirname(tmp) !== await realpath(root) || path.dirname(run) !== tmp ||
      !/^pr06-local-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path.basename(run))) {
    throw new Error('invalid_isolated_run_directory');
  }
  const output = path.resolve(outputPath);
  const parent = await realpath(path.dirname(output));
  if (parent !== run && !inside(run, parent)) throw new Error('output_must_be_inside_run_directory');
  // mkdir without recursive is the exclusive ownership claim, even on reruns.
  await mkdir(path.join(parent, path.basename(output)), { mode: 0o700 });
  const ownedOutput = path.join(parent, path.basename(output));
  const summaryFile = await open(path.join(ownedOutput, 'matrix-summary.json'), 'wx', 0o600);
  const summary = { schemaVersion: 1, releaseQualified: false, status: 'running', scenarios: [],
    fixture: 'Existing isolated identities/agents; fresh empty conversation per identity and scenario.',
    requestMix: 'One real generation per user; 1/2/5 SSE readers per user; unchanged input prompts/model/dataset.',
    missingEvidence: ['authoritative provider overlap', 'browser measurements', 'recovery', 'baseline comparison'] };
  const previousTokens = new Map();
  let stage = 'private_inputs';
  try {
    const config = await readJson(path.join(run, 'benchmark.json'));
    const tokens = await readJson(path.join(run, 'tokens.json'));
    const seed = await readJson(path.join(run, 'fixture-seed.json'));
    if (config.identities?.length !== 30 || !Array.isArray(seed.identities)) throw new Error('invalid_fixture');
    const agents = new Map();
    for (const identity of seed.identities) {
      if (!objectId(identity.userId) || !objectId(identity.agentId) || agents.has(identity.userId)) throw new Error('invalid_fixture');
      agents.set(identity.userId, identity.agentId);
    }
    for (const identity of config.identities) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(identity.tokenEnv) || typeof tokens[identity.tokenEnv] !== 'string' ||
          !agents.has(identity.userId)) throw new Error('invalid_fixture');
      previousTokens.set(identity.tokenEnv, process.env[identity.tokenEnv]);
      process.env[identity.tokenEnv] = tokens[identity.tokenEnv];
    }
    const base = { ...config, users: 30, deadlineMs: 180000 };
    validate(base);
    // Refuse non-local endpoints even if a private config is accidentally replaced.
    for (const replica of base.replicas) {
      const url = new URL(replica);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('nonlocal_replica');
    }
    const usedConversations = new Set(base.identities.map(identity => identity.conversationId));
    const ownedHistory = new Map(base.identities.map(identity => [identity.userId, new Set([identity.conversationId])]));
    stage = 'authorized_history_discovery';
    for (const [index, identity] of base.identities.entries()) {
      const response = await fetch(`${base.replicas[index % 2]}/conversations?limit=20&page=1`, {
        headers: { Authorization: `Bearer ${process.env[identity.tokenEnv]}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('history_discovery_failed');
      const body = await response.json(), data = body?.data ?? body;
      if (!Array.isArray(data.conversations) || data.pagination?.totalPages > 1) throw new Error('history_discovery_incomplete');
      for (const conversation of data.conversations) {
        const id = conversation.id ?? conversation._id;
        if (!objectId(id)) throw new Error('invalid_history_id');
        ownedHistory.get(identity.userId).add(id);
        usedConversations.add(id);
      }
    }
    for (const users of [10, 30]) for (const tabs of [1, 2, 5]) {
      const scenario = { users, tabs, releaseQualified: false, status: 'preparing', createdConversations: 0 };
      summary.scenarios.push(scenario);
      stage = 'conversation_creation';
      const identities = [];
      for (const [index, identity] of base.identities.slice(0, users).entries()) {
        const response = await fetch(`${base.replicas[index % 2]}/conversations`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[identity.tokenEnv]}` },
          body: JSON.stringify({ title: `PR06 matrix ${users} users ${tabs} tabs`, rootAgentId: agents.get(identity.userId) }),
        });
        if (response.status !== 201) {
          scenario.creationHttpStatus = response.status;
          await response.body?.cancel();
          throw new Error('creation_failed');
        }
        const body = await response.json();
        const created = body?.data ?? body;
        const id = created?.id ?? created?._id;
        if (!objectId(id) || usedConversations.has(id)) throw new Error('invalid_created_id');
        usedConversations.add(id);
        ownedHistory.get(identity.userId).add(id);
        identities.push({ ...identity, conversationId: id, allowedConversationIds: [...ownedHistory.get(identity.userId)] });
        scenario.createdConversations++;
      }
      stage = 'benchmark';
      const report = await benchmark({ ...base, identities, users, tabs });
      report.releaseQualified = false;
      const reportFile = await open(path.join(ownedOutput, `${users}-users-${tabs}-tabs.json`), 'wx', 0o600);
      try { await reportFile.writeFile(JSON.stringify(report, null, 2)); } finally { await reportFile.close(); }
      Object.assign(scenario, { status: 'measured', transportPass: report.transportPass,
        cleanup: report.cleanup, ttftMs: report.ttftMs,
        firstModelEventEmissionToReceiveMs: report.firstModelEventEmissionToReceiveMs });
      console.log(JSON.stringify(scenario));
      if (!report.transportPass || report.cleanup?.unresolved !== 0) throw new Error('scenario_failed');
    }
    summary.status = 'measured';
  } catch {
    summary.status = 'stopped';
    summary.failure = { stage, reason: 'Stopped safely; inspect aggregate scenario evidence, not private input files.' };
    process.exitCode = 1;
  } finally {
    for (const [key, value] of previousTokens) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try { await summaryFile.writeFile(JSON.stringify(summary, null, 2)); } finally { await summaryFile.close(); }
  }
  console.log(JSON.stringify({ status: summary.status, scenarios: summary.scenarios.length, releaseQualified: false }));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [runDirectory, outputDirectory, ...extra] = process.argv.slice(2);
  if (!runDirectory || !outputDirectory || extra.length) {
    console.error('Usage: node scripts/benchmark-classic-conversation-sse-matrix.mjs RUN_DIRECTORY NEW_OUTPUT_DIRECTORY');
    process.exitCode = 1;
  } else {
    matrix(runDirectory, outputDirectory).catch(() => {
      console.error('Matrix failed: verify isolated run and new output directory; private error details suppressed.');
      process.exitCode = 1;
    });
  }
}
