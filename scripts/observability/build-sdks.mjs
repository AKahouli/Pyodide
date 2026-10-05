// Builds the shared observability SDK artifacts and stages them into each consumer's
// ignored .generated/observability/ directory (plan §11.2), so service Docker builds
// (which only see their own subdirectory) can install the tarball before npm ci.
// Run before npm install/build of any consumer; CI wires this in P08.
// If the artifacts changed without a version bump, npm's cache can serve the stale
// tgz/wheel on reinstall — clear node_modules/<pkg> (or bump the SDK version).
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const sdkDir = path.join(repoRoot, 'packages', 'observability-ts');
const consumers = [
  path.join(repoRoot, 'YellowStorm', 'back'),
  path.join(repoRoot, 'yellowstorm-code-runtime'),
];

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

sh('npm run build', sdkDir);
const staging = path.join(repoRoot, '.generated', 'observability', 'staging');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
sh(`npm pack --pack-destination ${JSON.stringify(staging)}`, sdkDir);
const tarball = readdirSync(staging).find((f) => f.endsWith('.tgz'));
if (!tarball) throw new Error('npm pack produced no tarball');

const sha256 = createHash('sha256').update(readFileSync(path.join(staging, tarball))).digest('hex');

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
]) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyFileSync(path.join(wheelDir, wheel), path.join(dest, wheel));
  writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[observability] staged ${wheel} -> ${path.relative(repoRoot, dest)}`);
}
rmSync(path.join(repoRoot, '.generated'), { recursive: true, force: true });
