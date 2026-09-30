/**
 * Conformance checks for platform-owned files that already exist in a revision.
 *
 * The baseline injects these files, so at deploy time a difference means the
 * agent rewrote one. We do not require byte equality (restyling AuthPages is
 * legitimate) — only the runtime invariants that make preview and production
 * work: App Data origin for auth, a single router honouring the deploy
 * sub-path, and the platform AI proxy.
 */

const APP_DATA_URL_RE = /import\.meta\.env\.VITE_YM_APP_DATA_URL|process\.env\.VITE_YM_APP_DATA_URL/;
const API_BASE_URL_RE = /import\.meta\.env\.VITE_YM_API_BASE_URL|process\.env\.VITE_YM_API_BASE_URL/;
const AUTH_ROUTE_RE =
  /\/auth\/(login|register|logout|refresh)|['"`]\/login['"`]|['"`]\/register['"`]/;
const YELLOWMIND_AI_IMPORT_RE =
  /from\s+['"][^'"]*yellowmind-ai['"]|import\s*\(\s*['"][^'"]*yellowmind-ai['"]\s*\)/;
const APP_BASE_EXPORT = 'resolveRouterBasename';
const REMOTE_AI_CALL_RE =
  /\b(chatCompletion|streamChatCompletion|generateAiReply)\s*\(|\/chat\/completions/;
const CREATE_AI_CLIENT_RE = /\bcreateAIClient\s*\(/;
const DEPLOY_API_BASE = 'import.meta.env.VITE_YM_API_BASE_URL';

export function checkAuthModule(source: string): string[] {
  const violations: string[] = [];
  if (!source.trim()) {
    return ['Auth module is empty.'];
  }
  if (!APP_DATA_URL_RE.test(source)) {
    violations.push(
      'Auth must read import.meta.env.VITE_YM_APP_DATA_URL (injected in preview and at deploy).',
    );
  }
  if (API_BASE_URL_RE.test(source) && AUTH_ROUTE_RE.test(source)) {
    violations.push(
      'Do not build login/register URLs from VITE_YM_API_BASE_URL; App Data auth uses VITE_YM_APP_DATA_URL.',
    );
  }
  return violations;
}

export function checkAppRouter(source: string): string[] {
  const violations: string[] = [];
  if (!/\bBrowserRouter\b/.test(source)) {
    violations.push('src/AppRouter must mount a single <BrowserRouter>.');
  }
  if (!/resolveRouterBasename\s*\(|basename\s*=/.test(source)) {
    violations.push(
      'src/AppRouter must pass resolveRouterBasename() as the router basename so deploy sub-paths work.',
    );
  }
  if (!/['"`]\/login['"`]/.test(source) || !/['"`]\/register['"`]/.test(source)) {
    violations.push('src/AppRouter must keep the /login and /register routes.');
  }
  return violations;
}

export function checkAppBase(source: string): string[] {
  return source.includes(APP_BASE_EXPORT)
    ? []
    : ['src/lib/app-base must export resolveRouterBasename().'];
}

export function checkDataModule(source: string): string[] {
  return APP_DATA_URL_RE.test(source)
    ? []
    : ['src/lib/yellowmind-data must read import.meta.env.VITE_YM_APP_DATA_URL.'];
}

/** Any app source may call AI; it must go through the platform proxy. */
export function checkAiUsage(source: string): string[] {
  if (!source.trim()) return [];
  const callsRemoteAi = YELLOWMIND_AI_IMPORT_RE.test(source) || REMOTE_AI_CALL_RE.test(source);
  if (!callsRemoteAi) return [];

  const usesPlatformClient =
    YELLOWMIND_AI_IMPORT_RE.test(source) || CREATE_AI_CLIENT_RE.test(source);
  const usesDeployApiBase = source.includes(DEPLOY_API_BASE);
  return usesPlatformClient || usesDeployApiBase
    ? []
    : [
        'Use @/lib/yellowmind-ai (createAIClient / chatCompletion) or import.meta.env.VITE_YM_API_BASE_URL for /chat/completions — do not hardcode external AI URLs.',
      ];
}

/** Invariants for a managed file the agent modified. Empty array means fine. */
export function checkManagedFileConformance(path: string, source: string): string[] {
  switch (path) {
    case 'src/lib/yellowmind-auth.tsx':
      return checkAuthModule(source);
    case 'src/AppRouter.tsx':
      return checkAppRouter(source);
    case 'src/lib/app-base.ts':
      return checkAppBase(source);
    case 'src/lib/yellowmind-data.ts':
      return checkDataModule(source);
    case 'src/lib/yellowmind-ai.ts':
      return checkAiUsage(source);
    default:
      return source.trim() ? [] : [`${path} is empty.`];
  }
}
