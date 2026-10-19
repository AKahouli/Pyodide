import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fixture } from './fixture.mjs';
import { resolveMemoryTarget } from '../runtime/lib/memory-settings.mjs';

test('memory settings use environment, file, harness, nearest ancestor, then bank precedence', () => {
  const f = fixture();
  try {
    const nested = path.join(f.root, 'src', 'feature'); mkdirSync(nested);
    const raw = { disabled: false, apiUrl: 'http://file.invalid', paths: { [f.root]: { retainSessions: false }, [path.join(f.root, 'src')]: { apiUrl: 'http://nearest.invalid' } }, banks: { main: { retainSessions: false } }, harnesses: { opencode: { apiUrl: 'http://harness.invalid', paths: { [f.root]: { disabled: true } }, banks: { main: { disabled: false } } } } };
    const env = { HINDSIGHT_DISABLED: 'true', HINDSIGHT_API_URL: 'http://env.invalid', HINDSIGHT_RETAIN_SESSIONS: 'off' };
    const current = resolveMemoryTarget(raw, nested, env).cfg;
    assert.equal(current.disabled, false);
    assert.equal(current.apiUrl, 'http://nearest.invalid');
    assert.equal(current.retainSessions, false);
    const bank = resolveMemoryTarget({ ...raw, bankId: 'main' }, f.root, env).cfg;
    assert.equal(bank.disabled, false);
    assert.equal(bank.retainSessions, false); // Env survives; harness replaces the bank section.
    assert.equal(bank.apiUrl, 'http://harness.invalid');
    assert.equal(resolveMemoryTarget({ paths: { [f.root]: { disabled: true } } }, f.root + '-different', {}).cfg.disabled, false);
  } finally { f.cleanup(); }
});

test('linked worktree inherits main-root paths only when enabled and direct path takes priority', () => {
  const f = fixture(); const outside = fixture();
  try {
    const linked = path.join(outside.root, 'linked');
    execFileSync('git', ['worktree', 'add', '-qb', 'memory-linked', linked], { cwd: f.root, stdio: 'pipe', windowsHide: true });
    const raw = { paths: { [f.root]: { apiUrl: 'http://main.invalid' } } };
    assert.equal(resolveMemoryTarget(raw, linked, {}).cfg.apiUrl, 'http://main.invalid');
    assert.equal(resolveMemoryTarget({ ...raw, resolveWorktrees: false }, linked, {}).cfg.apiUrl, 'https://api.hindsight.vectorize.io');
    assert.equal(resolveMemoryTarget({ ...raw, paths: { ...raw.paths, [linked]: { apiUrl: 'http://direct.invalid' } } }, linked, {}).cfg.apiUrl, 'http://direct.invalid');
    assert.equal(resolveMemoryTarget(raw, path.join(linked, 'src'), {}).cfg.apiUrl, 'http://main.invalid');
  } finally { outside.cleanup(); f.cleanup(); }
});

test('opt-in precedes overrides, tilde paths expand, and daemon overrides resolve endpoints', () => {
  const root = path.join(homedir(), 'memory-test', 'child');
  const cfg = resolveMemoryTarget({ bankId: 'main', optInOnly: true, optInPaths: ['~/memory-test'], serverMode: 'daemon', apiPort: 9000, paths: { '~/memory-test': { apiPort: 9010, disabled: true } }, banks: { main: { disabled: false, apiToken: 'private-test-value' } } }, root, {}).cfg;
  assert.equal(cfg.disabled, false);
  assert.equal(cfg.apiUrl, 'http://127.0.0.1:9010');
  assert.equal(cfg.apiToken, 'private-test-value');
  const blocked = resolveMemoryTarget({ bankId: 'main', optInOnly: true, banks: { main: { disabled: false, optInOnly: false } } }, root, {}).cfg;
  assert.equal(blocked.disabled, true);
  assert.equal(resolveMemoryTarget({ paths: { '~/memory-test': { serverMode: 'self-hosted', apiUrl: 'http://self.invalid', resolveWorktrees: false } } }, root, {}).cfg.apiUrl, 'http://self.invalid');
});

test('native target derives the default bank from the main repository and preserves workspace', () => {
  const f = fixture();
  try {
    const target = resolveMemoryTarget({}, f.root, {});
    assert.equal(target.bankId, `coding-agent::${path.basename(f.root)}`);
    assert.equal(target.workspace, f.root);
    assert.equal(target.cfg.disabled, false);
    assert.equal(resolveMemoryTarget({}, path.join(f.root, 'src'), {}).bankId, target.bankId);
    assert.equal(resolveMemoryTarget({}, 'C:\\prog\\YellowStorm-poc', {}).bankId, 'coding-agent::YellowStorm-poc');
  } finally { f.cleanup(); }
});

test('native target shares linked-worktree banks unless disabled and prefers direct longest-prefix maps', () => {
  const f = fixture(); const outside = fixture();
  try {
    const linked = path.join(outside.root, 'linked');
    execFileSync('git', ['worktree', 'add', '-qb', 'target-linked', linked], { cwd: f.root, stdio: 'pipe', windowsHide: true });
    const defaultBank = `coding-agent::${path.basename(f.root)}`;
    assert.equal(resolveMemoryTarget({}, linked, {}).bankId, defaultBank);
    assert.equal(resolveMemoryTarget({ resolveWorktrees: false }, linked, {}).bankId, 'coding-agent::linked');
    assert.equal(resolveMemoryTarget({}, linked, { HINDSIGHT_RESOLVE_WORKTREES: 'false' }).bankId, 'coding-agent::linked');
    const raw = { mapPathToBank: { [f.root]: 'main-bank', [outside.root]: 'outside-bank', [linked]: 'linked-bank', [path.join(linked, 'src')]: 'source-bank' } };
    assert.equal(resolveMemoryTarget(raw, linked, {}).bankId, 'linked-bank');
    assert.equal(resolveMemoryTarget(raw, path.join(linked, 'src'), {}).bankId, 'source-bank');
    assert.equal(resolveMemoryTarget({ mapPathToBank: { [f.root]: 'main-bank' }, optInOnly: true }, linked, {}).bankId, 'main-bank');
    assert.equal(resolveMemoryTarget({ mapPathToBank: { [f.root]: 'main-bank' }, optInOnly: true }, linked, {}).cfg.disabled, false);
  } finally { outside.cleanup(); f.cleanup(); }
});

test('native target respects fixed banks, templates and environment/file/harness precedence', () => {
  const f = fixture();
  try {
    assert.equal(resolveMemoryTarget({ bankId: 'fixed' }, f.root, {}).bankId, 'fixed');
    assert.equal(resolveMemoryTarget({ dynamicBankId: false }, f.root, {}).bankId, 'coding');
    assert.equal(resolveMemoryTarget({}, f.root, { HINDSIGHT_BANK_ID: 'env-bank' }).bankId, 'env-bank');
    assert.equal(resolveMemoryTarget({ bankId: 'file-bank', harnesses: { opencode: { bankId: 'harness-bank' } } }, f.root, { HINDSIGHT_BANK_ID: 'env-bank' }).bankId, 'harness-bank');
    const template = '{harness}::{project}::{gitProject}::{channel}::{user}';
    const env = { HINDSIGHT_BANK_ID: 'ignored-fixed', HINDSIGHT_DYNAMIC_BANK_ID: 'on', HINDSIGHT_BANK_ID_TEMPLATE: template, HINDSIGHT_CHANNEL_ID: 'dev', HINDSIGHT_USER_ID: 'tester' };
    assert.equal(resolveMemoryTarget({}, path.join(f.root, 'src'), env).bankId, `opencode::src::${path.basename(f.root)}::dev::tester`);
    assert.equal(resolveMemoryTarget({ bankIdTemplate: '{channel}::{user}' }, f.root, {}).bankId, 'default::anonymous');
    for (const name of ['unknown', 'constructor', '__proto__']) assert.throws(() => resolveMemoryTarget({ bankIdTemplate: `{${name}}` }, f.root, {}), /unknown placeholder/);
  } finally { f.cleanup(); }
});

test('native target applies the initial bank section once, ignores path rename and preserves approval precedence', () => {
  const f = fixture();
  try {
    const raw = {
      bankId: 'initial', serverMode: 'daemon', apiPort: 9000,
      paths: { [f.root]: { bank: 'ignored-path-bank', bankId: 'ignored-id', apiPort: 9010, retainSessions: true } },
      banks: { initial: { bank: 'renamed', apiToken: 'test-private-value', retainSessions: false }, renamed: { apiToken: 'wrong-alias-credential', retainSessions: true } },
    };
    const target = resolveMemoryTarget(raw, f.root, {});
    assert.equal(target.bankId, 'renamed');
    assert.equal(target.cfg.apiToken, 'test-private-value');
    assert.equal(target.cfg.retainSessions, false);
    assert.equal(target.cfg.apiUrl, 'http://127.0.0.1:9010');
    const blocked = resolveMemoryTarget({ ...raw, optInOnly: true, banks: { initial: { disabled: false, optInOnly: false, bank: 'renamed' } } }, f.root, {});
    assert.equal(blocked.cfg.disabled, true);
    assert.equal(blocked.bankId, 'initial');
    const disabled = resolveMemoryTarget({ ...raw, disabled: true }, f.root, {});
    assert.equal(disabled.cfg.disabled, true);
    assert.equal(disabled.bankId, '');
    assert.equal(resolveMemoryTarget({ ...raw, optInOnly: true, optInPaths: [f.root] }, f.root, {}).cfg.disabled, false);
  } finally { f.cleanup(); }
});
