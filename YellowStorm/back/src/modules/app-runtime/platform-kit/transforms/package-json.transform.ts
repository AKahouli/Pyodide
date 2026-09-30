import {
  PLATFORM_KIT_DEPENDENCIES,
  PLATFORM_KIT_DEV_DEPENDENCIES,
} from '../platform-kit';

export interface PackageJsonTransformResult {
  content: string | null;
  changed: boolean;
  added: string[];
  violation: string | null;
}

const DEFAULT_SCRIPTS: Record<string, string> = {
  dev: 'vite',
  build: 'vite build',
  preview: 'vite preview',
};

const CRA_VIOLATION =
  'Create React App (react-scripts) cannot run in App Builder. Convert the project to Vite first.';
const NEXT_VIOLATION =
  'Next.js cannot run in App Builder. Convert the project to Vite first.';

/**
 * Add the dependencies the platform files import. Template-declared versions
 * always win — a template pinning React 18 keeps React 18.
 */
export function transformPackageJson(source: string | null): PackageJsonTransformResult {
  let parsed: Record<string, unknown>;
  if (source === null) {
    parsed = { name: 'app', private: true, version: '0.0.0', type: 'module' };
  } else {
    try {
      parsed = JSON.parse(source) as Record<string, unknown>;
    } catch {
      return {
        content: null,
        changed: false,
        added: [],
        violation: 'package.json is not valid JSON, so platform dependencies cannot be merged.',
      };
    }
  }

  const deps = { ...((parsed.dependencies as Record<string, string>) ?? {}) };
  const devDeps = { ...((parsed.devDependencies as Record<string, string>) ?? {}) };
  const scripts = { ...((parsed.scripts as Record<string, string>) ?? {}) };
  const scriptBlob = Object.values(scripts).join('\n');

  if (deps['react-scripts'] || devDeps['react-scripts'] || /\breact-scripts\b/.test(scriptBlob)) {
    return { content: null, changed: false, added: [], violation: CRA_VIOLATION };
  }
  if (deps.next || devDeps.next || /\bnext\s+(dev|start|build)\b/.test(scriptBlob)) {
    return { content: null, changed: false, added: [], violation: NEXT_VIOLATION };
  }

  const added: string[] = [];

  for (const [name, version] of Object.entries(PLATFORM_KIT_DEPENDENCIES)) {
    if (!deps[name] && !devDeps[name]) {
      deps[name] = version;
      added.push(name);
    }
  }
  for (const [name, version] of Object.entries(PLATFORM_KIT_DEV_DEPENDENCIES)) {
    if (!deps[name] && !devDeps[name]) {
      devDeps[name] = version;
      added.push(name);
    }
  }

  let scriptsChanged = false;
  for (const [name, command] of Object.entries(DEFAULT_SCRIPTS)) {
    if (!scripts[name]) {
      scripts[name] = command;
      scriptsChanged = true;
    }
  }

  if (!added.length && !scriptsChanged && source !== null) {
    return { content: null, changed: false, added: [], violation: null };
  }

  const next = {
    ...parsed,
    scripts,
    dependencies: sortRecord(deps),
    ...(Object.keys(devDeps).length ? { devDependencies: sortRecord(devDeps) } : {}),
  };

  return {
    content: `${JSON.stringify(next, null, 2)}\n`,
    changed: true,
    added,
    violation: null,
  };
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
