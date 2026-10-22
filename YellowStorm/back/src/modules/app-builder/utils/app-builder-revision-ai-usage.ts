import type { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';

/** Import / call sites that mean the generated app actually uses Approach B AI. */
export const REVISION_AI_USAGE_RE =
  /from\s+['"][^'"]*yellowmind-ai['"]|import\s*\(\s*['"][^'"]*yellowmind-ai['"]\s*\)|require\(\s*['"][^'"]*yellowmind-ai['"]\s*\)|createAIClient\s*\(|\bchatCompletion\s*\(|\bstreamChatCompletion\s*\(|\bgenerateAiReply\s*\(|\/chat\/completions/;

const SOURCE_EXT_RE = /\.(tsx?|jsx?|mts|cts)$/i;
const MAX_FILES_PER_REVISION = 40;

function isAiLibraryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return (
    normalized === 'src/lib/yellowmind-ai.ts'
    || normalized.endsWith('/yellowmind-ai.ts')
    || normalized.endsWith('/yellowmind-ai.js')
    || normalized.endsWith('/yellowmind-ai.jsx')
    || normalized === 'src/lib/ym-diag.ts'
    || normalized.endsWith('/ym-diag.ts')
  );
}

export function isScannableAppSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (!SOURCE_EXT_RE.test(normalized)) return false;
  if (normalized.includes('node_modules/')) return false;
  if (isAiLibraryPath(normalized)) return false;
  return true;
}

/**
 * True when app source (not the starter library stub) imports or calls the AI client.
 * Starter V6 ships `yellowmind-ai` without requiring deploy-time `VITE_YM_API_BASE_URL`.
 */
export async function detectRevisionUsesAi(
  revisions: Pick<RuntimeRevisionService, 'listFiles' | 'readRevisionFileText'>,
  workspaceId: string,
  revisionId: string,
): Promise<boolean> {
  const { files } = await revisions.listFiles(workspaceId, revisionId);
  const candidates = files
    .map((file) => file.path)
    .filter(isScannableAppSourcePath)
    .slice(0, MAX_FILES_PER_REVISION);

  for (const path of candidates) {
    const text = await revisions.readRevisionFileText(workspaceId, revisionId, path);
    if (text && REVISION_AI_USAGE_RE.test(text)) {
      return true;
    }
  }
  return false;
}
