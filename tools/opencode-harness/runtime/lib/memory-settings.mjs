import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Mirrors the installed Hindsight configuration rules, without importing its
// plugin (which would register another integration) or exposing credentials.
const excluded = new Set(['bankId', 'bankIdTemplate', 'mapPathToBank', 'dynamicBankId', 'resolveWorktrees', 'optInOnly', 'optInPaths', 'harness', 'banks', 'paths']);
const merge = (base, layer) => {
  const { harnesses, ...flat } = layer ?? {};
  return { ...base, ...flat, banks: { ...base.banks, ...flat.banks }, paths: { ...base.paths, ...flat.paths } };
};
const configured = directory => path.normalize(directory === '~' || directory.startsWith('~/') ? path.join(homedir(), directory.slice(1)) : directory).replace(new RegExp(`\\${path.sep}+$`), '');
const within = (directory, ancestor) => directory === ancestor || directory.startsWith(ancestor + path.sep);
function lookup(map, directory) {
  let best;
  for (const [key, value] of Object.entries(map ?? {})) {
    const candidate = configured(key);
    if (within(directory, candidate) && (!best || candidate.length > best.length)) best = { length: candidate.length, value };
  }
  return best?.value;
}
function mainRoot(directory, env) {
  for (const input of [directory, env.CLAUDE_PROJECT_DIR]) {
    if (!input) continue;
    let current = path.resolve(input);
    while (!existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
    for (;;) {
      const marker = path.join(current, '.git');
      let gitDirectory;
      if (existsSync(marker)) {
        if (statSync(marker).isDirectory()) gitDirectory = marker;
        else {
          const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(readFileSync(marker, 'utf8'));
          if (match) gitDirectory = path.resolve(current, match[1]);
        }
      } else if (existsSync(path.join(current, 'HEAD')) && existsSync(path.join(current, 'objects')) && existsSync(path.join(current, 'refs'))) gitDirectory = current;
      if (gitDirectory && existsSync(gitDirectory) && statSync(gitDirectory).isDirectory()) {
        const common = path.join(gitDirectory, 'commondir');
        const commonDirectory = realpathSync(existsSync(common) ? path.resolve(gitDirectory, readFileSync(common, 'utf8').trim()) : gitDirectory);
        const config = path.join(commonDirectory, 'config');
        const bare = existsSync(config) && /^\s*bare\s*=\s*true\s*$/im.test(readFileSync(config, 'utf8'));
        return path.basename(commonDirectory) === '.git' || (path.basename(commonDirectory).startsWith('.') && bare) ? path.dirname(commonDirectory) : commonDirectory;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}
function resolve(raw) {
  const serverMode = ['cloud', 'self-hosted', 'daemon'].includes(raw.serverMode) ? raw.serverMode : 'cloud';
  const apiPort = raw.apiPort || 9077;
  return { ...raw, serverMode, apiPort, apiUrl: serverMode === 'daemon' ? `http://127.0.0.1:${apiPort}` : raw.apiUrl ?? 'https://api.hindsight.vectorize.io', apiToken: raw.apiToken || undefined, disabled: raw.disabled ?? false, retainSessions: raw.retainSessions ?? true, optInOnly: raw.optInOnly ?? false, optInPaths: Array.isArray(raw.optInPaths) ? raw.optInPaths.filter(item => typeof item === 'string' && item.trim()) : [] };
}
function override(cfg, section) {
  const patch = Object.fromEntries(Object.entries(section).filter(([key]) => !excluded.has(key) && key !== 'bank'));
  const normalized = resolve(patch);
  const next = { ...cfg };
  for (const key of Object.keys(patch)) next[key] = normalized[key];
  if (['serverMode', 'apiUrl', 'apiPort'].some(key => key in patch)) {
    const connection = resolve({ serverMode: patch.serverMode ?? cfg.serverMode, apiPort: patch.apiPort ?? cfg.apiPort, apiUrl: patch.apiUrl ?? (cfg.serverMode === 'daemon' ? undefined : cfg.apiUrl) });
    for (const key of ['serverMode', 'apiUrl', 'apiPort']) next[key] = connection[key];
  }
  return next;
}

// Resolve the same initial bank as the host plugin, then apply its path and
// initial-bank overrides. Final aliases must not select a different section.
export function resolveMemoryTarget(raw, root, env = process.env) {
  const fromEnv = {};
  for (const key of ['disabled', 'retainSessions', 'resolveWorktrees', 'optInOnly', 'dynamicBankId']) {
    const name = `HINDSIGHT_${key.replace(/[A-Z]/g, letter => '_' + letter).toUpperCase()}`;
    if (env[name]?.trim()) fromEnv[key] = ['1', 'true', 'yes', 'on'].includes(env[name].trim().toLowerCase());
  }
  for (const [key, name] of [['apiUrl', 'HINDSIGHT_API_URL'], ['apiToken', 'HINDSIGHT_API_TOKEN'], ['serverMode', 'HINDSIGHT_SERVER_MODE'], ['bankId', 'HINDSIGHT_BANK_ID'], ['bankIdTemplate', 'HINDSIGHT_BANK_ID_TEMPLATE']]) if (env[name]?.trim()) fromEnv[key] = env[name];
  if (env.HINDSIGHT_API_PORT?.trim() && Number.isFinite(Number(env.HINDSIGHT_API_PORT))) fromEnv.apiPort = Number(env.HINDSIGHT_API_PORT);
  if (env.HINDSIGHT_OPT_IN_PATHS?.trim()) fromEnv.optInPaths = env.HINDSIGHT_OPT_IN_PATHS.split(',').map(item => item.trim()).filter(Boolean);
  let cfg = resolve(merge(merge(fromEnv, raw), raw?.harnesses?.opencode));
  if (cfg.disabled) return { cfg, bankId: '', workspace: root };
  const directories = [path.normalize(root)];
  const main = (cfg.resolveWorktrees ?? true) ? mainRoot(root, env) : undefined;
  if (main && path.normalize(main) !== directories[0]) directories.push(path.normalize(main));
  const mapped = directories.map(directory => lookup(cfg.mapPathToBank, directory)).find(bank => bank !== undefined);
  let bankId = mapped;
  if (!bankId) {
    if (!(cfg.dynamicBankId ?? !cfg.bankId)) bankId = cfg.bankId || 'coding';
    else {
      const resolvers = {
        harness: () => 'opencode',
        project: () => path.basename(root) || 'unknown',
        gitProject: () => path.basename(main || root) || 'unknown',
        channel: () => env.HINDSIGHT_CHANNEL_ID || 'default',
        user: () => env.HINDSIGHT_USER_ID || 'anonymous',
      };
      bankId = (cfg.bankIdTemplate || 'coding-agent::{gitProject}').replace(/\{([a-zA-Z_]+)\}/g, (_, name) => {
        if (!Object.hasOwn(resolvers, name)) throw new Error('Hindsight bank template contains an unknown placeholder; correct bankIdTemplate before retrying health checks.');
        return resolvers[name]();
      });
    }
  }
  if (cfg.optInOnly && !directories.some(directory => cfg.optInPaths.some(item => within(directory, configured(item))) || Boolean(lookup(cfg.mapPathToBank, directory)))) return { cfg: { ...cfg, disabled: true }, bankId, workspace: root };
  const section = directories.map(directory => lookup(cfg.paths, directory)).find(item => item !== undefined);
  if (section) cfg = override(cfg, section);
  const bankSection = cfg.banks?.[bankId];
  if (bankSection) {
    cfg = override(cfg, bankSection);
    if (typeof bankSection.bank === 'string' && bankSection.bank) bankId = bankSection.bank;
  }
  return { cfg, bankId, workspace: root };
}
