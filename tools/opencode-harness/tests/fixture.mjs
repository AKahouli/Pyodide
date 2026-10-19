import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'opencode-sdlc-test-'));
  for (const dir of ['tools/opencode-harness', 'docs/agent-context', 'src']) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), '.opencode/\nqa-artifacts/\n');
  writeFileSync(path.join(root, 'tools/opencode-harness/policy.json'), JSON.stringify({ documentationIndex: 'docs/agent-context/README.md', documentationRoutes: [{ prefix: 'src/', document: 'guidelines.md' }] }));
  writeFileSync(path.join(root, 'docs/agent-context/README.md'), '# Context\nReuse the existing function.\n');
  writeFileSync(path.join(root, 'guidelines.md'), '# Guidelines\nUse focused tests.\n');
  writeFileSync(path.join(root, 'src/a.js'), 'export const value = 1;\n');
  writeFileSync(path.join(root, 'src/b.js'), 'export const other = 2;\n');
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Harness verification', '-c', 'user.email=harness@example.invalid', '-c', 'core.hooksPath=.no-test-hooks', 'commit', '-qm', 'Fixture baseline']);
  return { root, cleanup() { assert.equal(path.dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); } };
}
