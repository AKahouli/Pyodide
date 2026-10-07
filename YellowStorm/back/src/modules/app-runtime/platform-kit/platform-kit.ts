import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Platform Kit v1 — the files every App Builder app must ship to run on the
 * platform (App Data auth, data, AI proxy, deploy sub-path routing).
 *
 * Source of truth is `app-data/templates/sources/**`, the same tree Starter V6
 * is materialized from. Templates uploaded by admins rarely contain any of it,
 * so the baseline normalizer injects it deterministically instead of asking the
 * agent to re-author these files.
 */

/** Bump when a managed file changes so existing workspaces can be re-normalized. */
export const PLATFORM_KIT_VERSION = 1;

/** Generated into the workspace so the agent knows what it must not rewrite. */
export const PLATFORM_MANIFEST_PATH = 'yellowstorm.platform.json';

export type PlatformFileKind = 'managed' | 'support';

export interface PlatformKitFile {
  /** Path inside the generated app. */
  path: string;
  /** File name under `app-data/templates/sources`, or null for inline content. */
  source: string | null;
  kind: PlatformFileKind;
  /** Used when `source` is null. */
  inline?: string;
}

/**
 * `managed`: platform-owned. Overwritten when a workspace is seeded, and must
 * still match at deploy time.
 * `support`: needed by the managed files but safe to leave alone when the
 * template already provides its own (for example a shadcn button).
 */
export const PLATFORM_KIT_FILES: readonly PlatformKitFile[] = [
  { path: 'src/lib/app-base.ts', source: 'app-base.ts', kind: 'managed' },
  { path: 'src/lib/ym-diag.ts', source: 'ym-diag.ts', kind: 'managed' },
  { path: 'src/lib/yellowmind-auth.tsx', source: 'yellowmind-auth.tsx', kind: 'managed' },
  { path: 'src/lib/yellowmind-data.ts', source: 'yellowmind-data.ts', kind: 'managed' },
  { path: 'src/lib/yellowmind-ai.ts', source: 'yellowmind-ai.ts', kind: 'managed' },
  {
    path: 'src/components/auth/ProtectedRoute.tsx',
    source: 'ProtectedRoute.tsx',
    kind: 'managed',
  },
  { path: 'src/pages/AuthPages.tsx', source: 'AuthPages.tsx', kind: 'managed' },
  { path: 'src/AppRouter.tsx', source: 'AppRouter.tsx', kind: 'managed' },

  { path: 'src/lib/utils.ts', source: 'ui/utils.ts', kind: 'support' },
  { path: 'src/components/ui/button.tsx', source: 'ui/button.tsx', kind: 'support' },
  { path: 'src/components/ui/input.tsx', source: 'ui/input.tsx', kind: 'support' },
  { path: 'src/components/ui/label.tsx', source: 'ui/label.tsx', kind: 'support' },
  { path: 'src/components/ui/card.tsx', source: 'ui/card.tsx', kind: 'support' },
  {
    path: 'src/vite-env.d.ts',
    source: null,
    kind: 'support',
    inline: '/// <reference types="vite/client" />\n',
  },
];

/** Added to `package.json` only when the template does not already declare them. */
export const PLATFORM_KIT_DEPENDENCIES: Readonly<Record<string, string>> = {
  react: '^19.1.0',
  'react-dom': '^19.1.0',
  'react-router-dom': '^7.6.0',
  openai: '^4.104.0',
  clsx: '^2.1.1',
  'tailwind-merge': '^3.3.0',
};

export const PLATFORM_KIT_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@vitejs/plugin-react': '^4.4.1',
  vite: '^6.3.5',
};

/** Entry points the normalizer rewrites to mount `AppRouter`. */
export const APP_ENTRY_CANDIDATES = [
  'src/main.jsx',
  'src/main.tsx',
  'src/main.js',
  'src/main.ts',
] as const;

/** Root business component mounted inside the protected route. */
export const APP_ROOT_CANDIDATES = [
  'src/App.jsx',
  'src/App.tsx',
  'src/App.js',
  'src/App.ts',
] as const;

const SOURCES_DIR = join(__dirname, '..', '..', 'app-data', 'templates', 'sources');

const cache = new Map<string, string>();

/** Read a kit file's content. Cached; throws when the asset is missing. */
export function readPlatformKitFile(file: PlatformKitFile): string {
  if (file.source === null) {
    return file.inline ?? '';
  }
  const cached = cache.get(file.source);
  if (cached !== undefined) return cached;

  try {
    const content = readFileSync(join(SOURCES_DIR, file.source), 'utf8');
    cache.set(file.source, content);
    return content;
  } catch (error) {
    throw new Error(
      `Platform kit source ${file.source} is missing at ${SOURCES_DIR}. ` +
        'Check the app-data/templates/sources asset copy in nest-cli.json. ' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function platformKitFilesByKind(kind: PlatformFileKind): readonly PlatformKitFile[] {
  return PLATFORM_KIT_FILES.filter((file) => file.kind === kind);
}

export function isManagedPlatformPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return PLATFORM_KIT_FILES.some(
    (file) => file.kind === 'managed' && file.path === normalized,
  );
}

export interface PlatformManifest {
  version: number;
  kitVersion: number;
  capabilities: { auth: 'app_data'; data: 'app_data'; ai: 'ai_proxy' };
  /** Files owned by the platform — the agent must not rewrite them. */
  managedFiles: string[];
  /** Business entry points the agent is expected to edit. */
  appRoot: string;
  entry: string;
}

export function buildPlatformManifest(input: {
  appRoot: string;
  entry: string;
}): PlatformManifest {
  return {
    version: 1,
    kitVersion: PLATFORM_KIT_VERSION,
    capabilities: { auth: 'app_data', data: 'app_data', ai: 'ai_proxy' },
    managedFiles: platformKitFilesByKind('managed').map((file) => file.path),
    appRoot: input.appRoot,
    entry: input.entry,
  };
}

export function serializePlatformManifest(manifest: PlatformManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
