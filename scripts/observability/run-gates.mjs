#!/usr/bin/env node
// Gate runner (plan §15): forwards nonzero exit codes; refuses fault/integration suites
// without an explicit test profile — never against production endpoints.
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const suite = process.argv[process.argv.indexOf('--suite') + 1] ?? 'unit';
// Python follows the repository convention (conda env `meta` locally); CI overrides via OBS_PYTHON.
const PY = process.env.OBS_PYTHON ?? 'python';

const run = (name, cmd, cwd) => {
  console.log(`\n=== [${name}] ${cmd} (cwd: ${path.relative(repoRoot, cwd) || '.'})`);
  const result = spawnSync(cmd, { shell: true, cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n[GATES] FAIL: ${name} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[${name}] PASS`);
};

if (suite === 'unit') {
  run('policy', 'node scripts/observability/check-policy.mjs', repoRoot);
  run('sdk-ts', 'npm test', path.join(repoRoot, 'packages', 'observability-ts'));
  // run inside the package dir: the repo root's pytest.ini pulls in unrelated plugins
  run('sdk-python', `${PY} -m pytest tests -q`, path.join(repoRoot, 'packages', 'observability-python'));
} else if (suite === 'integration') {
  // Requires the isolated stack from infra/observability and staged artifacts.
  run('staging', 'node scripts/observability/build-sdks.mjs', repoRoot);
  run('compose-config', 'docker compose config', path.join(repoRoot, 'infra', 'observability'));
  console.log('[gates] compose smoke validated; full emit→collect→query proof requires the P09 fault suite on a prepared host (BLOCKED otherwise)');
} else {
  console.error(`[gates] BLOCKED: unknown or unsafe suite '${suite}'. Use --suite unit|integration.`);
  process.exit(2);
}
console.log('\n[GATES] ALL PASS');
