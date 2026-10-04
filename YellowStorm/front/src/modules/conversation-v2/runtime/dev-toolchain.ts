/**
 * Toolchains that can / cannot boot inside NodePod (browser Node runtime).
 *
 * NodePod docs (https://r1ck404.github.io/Nodepod/): real Node primitives + HTTP
 * preview require the process to bind a reachable host. Vite must be started
 * with `--host 0.0.0.0` so the host app can attach the preview bridge.
 *
 * App Builder only supports Vite-based React SPAs — CRA webpack and Next.js
 * SWC fail in this sandbox.
 */

export const UNSUPPORTED_CRA_MESSAGE =
  'Create React App (react-scripts) is not supported inside NodePod. Use a Vite-based React template.';

export const UNSUPPORTED_NEXT_MESSAGE =
  'Next.js is not supported inside NodePod. Use a Vite-based React template.';

export const MISSING_VITE_MESSAGE =
  'This template has no Vite toolchain. NodePod preview requires a Vite-based React app (dependency `vite` or a `dev` script that runs Vite).';

export interface PackageJsonScriptsAndDeps {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function allDeps(pkg: PackageJsonScriptsAndDeps): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
}

/** Returns a user-facing reason when the package cannot run in NodePod, else null. */
export function unsupportedDevToolchainReason(
  pkg: PackageJsonScriptsAndDeps | null | undefined,
): string | null {
  if (!pkg) return MISSING_VITE_MESSAGE;
  const deps = allDeps(pkg);
  const scripts = Object.values(pkg.scripts ?? {}).join('\n');

  if (deps['react-scripts'] || /\breact-scripts\b/.test(scripts)) {
    return UNSUPPORTED_CRA_MESSAGE;
  }
  if (
    deps.next ||
    /\bnext\s+(dev|start|build)\b/.test(scripts) ||
    /(^|\n)\s*next(\s|$)/.test(scripts)
  ) {
    return UNSUPPORTED_NEXT_MESSAGE;
  }

  const hasViteDep = Boolean(deps.vite);
  const hasViteScript = /\bvite\b/i.test(scripts);
  if (!hasViteDep && !hasViteScript) {
    return MISSING_VITE_MESSAGE;
  }

  return null;
}

export class UnsupportedDevToolchainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDevToolchainError';
  }
}

function parsePackageJson(raw: unknown): PackageJsonScriptsAndDeps | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as PackageJsonScriptsAndDeps;
  } catch {
    return null;
  }
}

/**
 * Choose the npm script NodePod should spawn.
 * Prefer Vite; always bind `0.0.0.0` so the preview URL is reachable from the host.
 * Never fall back to CRA `npm start`.
 */
export function detectDevCommand(files: Record<string, string | Uint8Array>): {
  cmd: string;
  args: string[];
} {
  const pkg = parsePackageJson(files['/package.json']);
  const unsupported = unsupportedDevToolchainReason(pkg);
  if (unsupported) {
    throw new UnsupportedDevToolchainError(unsupported);
  }

  const scripts = pkg?.scripts ?? {};
  const hostArgs = ['--', '--host', '0.0.0.0'];

  if (scripts.dev) {
    const devScript = scripts.dev;
    // Always pass host for Vite (NodePod HTTP preview); idempotent if already present.
    if (/\bvite\b/i.test(devScript)) {
      if (/--host\b/i.test(devScript)) {
        return { cmd: 'npm', args: ['run', 'dev'] };
      }
      return { cmd: 'npm', args: ['run', 'dev', ...hostArgs] };
    }
    // Non-vite `dev` with vite as a dependency: still force host via npm extras when possible.
    return { cmd: 'npm', args: ['run', 'dev', ...hostArgs] };
  }

  // No `dev` script but Vite is installed — run the CLI directly (NodePod docs pattern).
  return { cmd: 'npx', args: ['vite', '--host', '0.0.0.0'] };
}
