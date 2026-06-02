#!/usr/bin/env node

const apiUrl = readEnv('PLAYBOOK_LOAD_API_URL', 'http://localhost:3000/api/v1');
const authToken = readEnv('PLAYBOOK_LOAD_AUTH_TOKEN', '');
const flowIds = readCsvEnv('PLAYBOOK_LOAD_FLOW_IDS');
const executionCount = readIntEnv('PLAYBOOK_LOAD_EXECUTIONS', 50);
const designCount = readIntEnv('PLAYBOOK_LOAD_DESIGNS', 50);
const concurrency = readIntEnv('PLAYBOOK_LOAD_CONCURRENCY', 10);
const scenario = readEnv('PLAYBOOK_LOAD_SCENARIO', 'mixed');
const pollTimeoutSeconds = readIntEnv('PLAYBOOK_LOAD_POLL_TIMEOUT_SECONDS', 120);
const pollIntervalMs = readIntEnv('PLAYBOOK_LOAD_POLL_INTERVAL_MS', 2_000);
const designQuery = readEnv('PLAYBOOK_LOAD_DESIGN_QUERY', 'Suggest one safe improvement without applying speculative changes.');

if (!['executions', 'designs', 'mixed'].includes(scenario)) {
  throw new Error('PLAYBOOK_LOAD_SCENARIO must be one of: executions, designs, mixed.');
}

if (flowIds.length === 0) {
  throw new Error('PLAYBOOK_LOAD_FLOW_IDS must contain at least one flow id.');
}

if (!authToken) {
  throw new Error('PLAYBOOK_LOAD_AUTH_TOKEN must contain a bearer token for the target environment.');
}

const headers = {
  authorization: `Bearer ${authToken}`,
  'content-type': 'application/json',
};

const startedAt = Date.now();
const executionJobs = scenario !== 'designs'
  ? Array.from({ length: executionCount }, (_, index) => ({
    kind: 'execution',
    index,
    flowId: flowIds[index % flowIds.length],
  }))
  : [];
const designJobs = scenario !== 'executions'
  ? Array.from({ length: designCount }, (_, index) => ({
    kind: 'design',
    index,
    flowId: flowIds[index % flowIds.length],
  }))
  : [];

const startResults = await runPool([...executionJobs, ...designJobs], concurrency, runJob);
const statusResults = pollTimeoutSeconds > 0
  ? await pollStartedJobs(startResults.filter((result) => result.ok && result.id))
  : [];
const durationMs = Date.now() - startedAt;
const summary = summarize(startResults, statusResults, durationMs);

console.log(JSON.stringify(summary, null, 2));

if (!summary.pass) {
  process.exitCode = 1;
}

async function runJob(job) {
  const startedAtMs = Date.now();
  try {
    const path = job.kind === 'execution'
      ? `/playbooks/${job.flowId}/executions`
      : `/playbooks/${job.flowId}/design-operations`;
    const body = job.kind === 'execution'
      ? { inputContext: { loadGate: true, loadGateIndex: job.index } }
      : { query: `${designQuery} [load-gate ${job.index}]`, idempotencyKey: `load-gate-${Date.now()}-${job.index}` };
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return {
      ...job,
      ok: response.ok,
      status: response.status,
      id: payload?.data?.id ?? payload?.data?.executionId ?? null,
      durationMs: Date.now() - startedAtMs,
      error: response.ok ? null : payload?.error?.message ?? response.statusText,
    };
  } catch (error) {
    return {
      ...job,
      ok: false,
      status: 0,
      id: null,
      durationMs: Date.now() - startedAtMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPool(items, limit, worker) {
  const results = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      results.push(await worker(item));
    }
  });
  await Promise.all(workers);
  return results;
}

function summarize(results, statusResults, durationMs) {
  const byKind = countBy(results, (result) => result.kind);
  const failedResults = results.filter((result) => !result.ok);
  const missingIds = results.filter((result) => result.ok && !result.id);
  const duplicateIds = findDuplicateIds(results);
  const finalStatusByKind = countBy(statusResults, (result) => `${result.kind}:${result.status ?? 'unknown'}`);
  const pollFailures = statusResults.filter((result) => !result.ok);
  const pass = failedResults.length === 0
    && missingIds.length === 0
    && duplicateIds.length === 0
    && pollFailures.length === 0;

  return {
    apiUrl,
    scenario,
    flowCount: flowIds.length,
    requested: results.length,
    succeeded: results.length - failedResults.length,
    failed: failedResults.length,
    pass,
    durationMs,
    averageLatencyMs: Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / Math.max(results.length, 1)),
    byKind,
    finalStatusByKind,
    duplicateIds,
    missingIds: missingIds.length,
    polled: statusResults.length,
    pollFailures: pollFailures.slice(0, 20).map((result) => ({
      kind: result.kind,
      id: result.id,
      flowId: result.flowId,
      status: result.status,
      error: result.error,
    })),
    failures: failedResults.slice(0, 20).map((result) => ({
      kind: result.kind,
      flowId: result.flowId,
      status: result.status,
      error: result.error,
    })),
  };
}

async function pollStartedJobs(startedJobs) {
  const deadline = Date.now() + pollTimeoutSeconds * 1_000;
  let latest = startedJobs.map((job) => ({
    ...job,
    ok: true,
    status: 'accepted',
    terminal: false,
    error: null,
  }));

  while (Date.now() < deadline) {
    latest = await runPool(latest, concurrency, pollJobStatus);
    if (latest.every((result) => result.terminal || result.ok === false)) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  return latest.map((result) => (
    result.terminal || result.ok === false
      ? result
      : { ...result, ok: false, error: `Timed out after ${pollTimeoutSeconds}s with status ${result.status}` }
  ));
}

async function pollJobStatus(job) {
  const path = job.kind === 'execution'
    ? `/executions/${job.id}`
    : `/playbooks/${job.flowId}/design-operations/${job.id}`;
  try {
    const response = await fetch(`${apiUrl}${path}`, { headers });
    const payload = await response.json().catch(() => null);
    const status = payload?.data?.status ?? 'unknown';
    return {
      ...job,
      ok: response.ok,
      status,
      terminal: isTerminalStatus(status),
      error: response.ok ? null : payload?.error?.message ?? response.statusText,
    };
  } catch (error) {
    return {
      ...job,
      ok: false,
      terminal: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function findDuplicateIds(results) {
  const seen = new Set();
  const duplicates = new Set();
  for (const result of results) {
    if (!result.id) continue;
    const scopedId = `${result.kind}:${result.id}`;
    if (seen.has(scopedId)) {
      duplicates.add(scopedId);
    }
    seen.add(scopedId);
  }
  return [...duplicates];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countBy(items, selector) {
  return items.reduce((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function readEnv(name, fallback) {
  return process.env[name] || fallback;
}

function readCsvEnv(name) {
  return readEnv(name, '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function readIntEnv(name, fallback) {
  const parsed = Number.parseInt(readEnv(name, String(fallback)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
