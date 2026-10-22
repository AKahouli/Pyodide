import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../install.ps1', import.meta.url));
function sandbox(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'opencode-distribution-'));
  const destination = path.join(root, 'personal config');
  mkdirSync(path.join(destination, 'node_modules/@opencode/plugin'), { recursive: true });
  t.after(() => { assert.equal(path.dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); });
  return { root, destination };
}
const install = (script, destination) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Destination', destination], { windowsHide: true, stdio: 'pipe', timeout: 20000 });

test('installer preserves personal settings and backs up overwritten instructions/model overrides', { skip: process.platform !== 'win32' }, t => {
  const { destination } = sandbox(t);
  writeFileSync(path.join(destination, 'AGENTS.md'), 'Personal instruction before install');
  writeFileSync(path.join(destination, 'opencode.json'), '{"personalSetting":"preserve"}');
  install(installer, destination);
  const backups = path.join(destination, '.sdlc-backups');
  const first = readdirSync(backups);
  assert.equal(first.length, 1);
  assert.equal(readFileSync(path.join(backups, first[0], 'AGENTS.md'), 'utf8'), 'Personal instruction before install');
  assert.equal(readFileSync(path.join(destination, 'opencode.json'), 'utf8'), '{"personalSetting":"preserve"}');
  for (const skill of ['chrome-devtools', 'graphify-navigation', 'context7-mcp', 'ponytail']) assert.match(readFileSync(path.join(destination, 'skills', skill, 'SKILL.md'), 'utf8'), /^---/);
  writeFileSync(path.join(destination, 'agents/frontend-qa.md'), 'model: personal/provider-model');
  install(installer, destination);
  const second = readdirSync(backups).filter(item => !first.includes(item));
  assert.equal(second.length, 1);
  assert.equal(readFileSync(path.join(backups, second[0], 'agents/frontend-qa.md'), 'utf8'), 'model: personal/provider-model');
  assert.equal(readFileSync(path.join(destination, 'opencode.json'), 'utf8'), '{"personalSetting":"preserve"}');
});

test('an incomplete distribution fails before replacing personal files', { skip: process.platform !== 'win32' }, t => {
  const { root, destination } = sandbox(t);
  const incomplete = path.join(root, 'incomplete-install.ps1');
  copyFileSync(installer, incomplete);
  writeFileSync(path.join(destination, 'AGENTS.md'), 'Keep this instruction');
  assert.throws(() => install(incomplete, destination));
  assert.equal(readFileSync(path.join(destination, 'AGENTS.md'), 'utf8'), 'Keep this instruction');
});
