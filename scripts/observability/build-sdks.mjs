// Builds the shared observability SDK artifacts and stages them into each consumer's
// ignored .generated/observability/ directory (plan §11.2), so service Docker builds
// (which only see their own subdirectory) can install the tarball before npm ci.
// Run before npm install/build of any consumer; CI wires this in P08.
// If the artifacts changed without a version bump, npm's cache can serve the stale
// tgz/wheel on reinstall — clear node_modules/<pkg> (or bump the SDK version).
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packCanonicalSdk, verifyConsumerIntegrities } from './pack-sdk.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => argument !== '--update-locks') || arguments_.length > 1) {
  throw new Error('Usage: node scripts/observability/build-sdks.mjs [--update-locks]');
}

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const sdkDir = path.join(repoRoot, 'packages', 'observability-ts');
const consumers = [
  path.join(repoRoot, 'YellowStorm', 'back'),
  path.join(repoRoot, 'yellowstorm-code-runtime'),
];

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

sh('npm ci --ignore-scripts', sdkDir);
sh('npm run build', sdkDir);
const staging = path.join(repoRoot, '.generated', 'observability', 'staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const artifact = packCanonicalSdk(sdkDir, staging);
const tarball = artifact.filename;
const sha256 = artifact.sha256;
verifyConsumerIntegrities(consumers, artifact.integrity, arguments_.includes('--update-locks'));

let gitRev = 'unknown';
try {
  gitRev = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
} catch {}

const manifest = { file: tarball, sha256, git_rev: gitRev, built_at: new Date().toISOString() };

for (const consumer of consumers) {
  const dest = path.join(consumer, '.generated', 'observability');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyFileSync(path.join(staging, tarball), path.join(dest, tarball));
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[observability] staged ${tarball} -> ${path.relative(repoRoot, dest)}`);
}

// Python wheel -> consumers with a requirements.txt file: dep (installed relative to each service).
const pyPkg = path.join(repoRoot, 'packages', 'observability-python');
const wheelDir = path.join(repoRoot, '.generated', 'observability', 'wheel');
rmSync(wheelDir, { recursive: true, force: true });
mkdirSync(wheelDir, { recursive: true });
// -w resolves relative to pip's cwd: pass the absolute staging dir.
sh(`pip wheel . --no-deps -w ${JSON.stringify(wheelDir)}`, pyPkg);
const wheel = readdirSync(wheelDir).find((f) => f.endsWith('.whl'));
if (!wheel) throw new Error('pip wheel produced no artifact');
for (const dest of [
  path.join(repoRoot, 'yellowstorm-adk', '.generated', 'observability'),
  path.join(repoRoot, 'YellowStorm', 'semantic-model-runtime', '.generated', 'observability'),
  path.join(repoRoot, 'mcp', 'mcp-agent', '.generated', 'observability'),
  path.join(repoRoot, 'mcp', 'mcp-playbook', '.generated', 'observability'),
  path.join(repoRoot, 'mcp', 'mcp-semantic-model', '.generated', 'observability'),
]) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyFileSync(path.join(wheelDir, wheel), path.join(dest, wheel));
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[observability] staged ${wheel} -> ${path.relative(repoRoot, dest)}`);
}
rmSync(path.join(repoRoot, '.generated'), { recursive: true, force: true });
