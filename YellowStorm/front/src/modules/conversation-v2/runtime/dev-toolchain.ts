/**
 * Toolchains that cannot boot inside NodePod (WASI). App Builder only supports
 * Vite-based React apps — CRA webpack and Next.js SWC fail immediately.
 */

export const UNSUPPORTED_CRA_MESSAGE =
  'Create React App (react-scripts) is not supported inside NodePod. Use a Vite-based React template.';

export const UNSUPPORTED_NEXT_MESSAGE =
  'Next.js is not supported inside NodePod. Use a Vite-based React template.';

export interface PackageJsonScriptsAndDeps {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Returns a user-facing reason when the package cannot run in NodePod, else null. */
export function unsupportedDevToolchainReason(
  pkg: PackageJsonScriptsAndDeps | null | undefined,
): string | null {
  if (!pkg) return null;
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
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
 * Choose the npm script NodePod should spawn. Prefer Vite; never fall back to
 * CRA `npm start` (react-scripts exits immediately under WASI).
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
  if (scripts.dev) {
    const devScript = scripts.dev;
    if (/\bvite\b/i.test(devScript) && !/--host/i.test(devScript)) {
      return { cmd: 'npm', args: ['run', 'dev', '--', '--host', '0.0.0.0'] };
    }
    return { cmd: 'npm', args: ['run', 'dev'] };
  }
  return { cmd: 'npm', args: ['run', 'dev', '--', '--host', '0.0.0.0'] };
}
