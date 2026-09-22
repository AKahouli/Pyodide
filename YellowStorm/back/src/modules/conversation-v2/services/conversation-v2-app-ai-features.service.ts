import { Injectable, Logger } from '@nestjs/common';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { ConversationV2SessionService } from './conversation-v2-session.service';

/** Import / call sites that mean the generated app actually uses Approach B AI. */
const AI_USAGE_RE =
  /from\s+['"][^'"]*yellowmind-ai['"]|import\s*\(\s*['"][^'"]*yellowmind-ai['"]\s*\)|require\(\s*['"][^'"]*yellowmind-ai['"]\s*\)|createAIClient\s*\(|\bchatCompletion\s*\(|\bstreamChatCompletion\s*\(/;

const SOURCE_EXT_RE = /\.(tsx?|jsx?|mts|cts)$/i;
const MAX_FILES_PER_REVISION = 40;
/** Bound catalog rescans so a large hub page stays responsive. */
const MAX_DETECT_PER_LIST = 48;

function isAiLibraryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return (
    normalized === 'src/lib/yellowmind-ai.ts'
    || normalized.endsWith('/yellowmind-ai.ts')
    || normalized === 'src/lib/ym-diag.ts'
    || normalized.endsWith('/ym-diag.ts')
  );
}

function isScannableSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (!SOURCE_EXT_RE.test(normalized)) return false;
  if (normalized.includes('node_modules/')) return false;
  if (isAiLibraryPath(normalized)) return false;
  return true;
}

export interface AppAiFeaturesCatalogInput {
  sessionId: string;
  workspaceId: string | null;
  /** Preferred revision to inspect (deployed, else latest finalized). */
  revisionId: string | null;
  hasAiFeatures: boolean;
  aiFeaturesCheckedRevisionId: string | null;
}

@Injectable()
export class ConversationV2AppAiFeaturesService {
  private readonly logger = new Logger(ConversationV2AppAiFeaturesService.name);

  constructor(
    private readonly revisions: RuntimeRevisionService,
    private readonly sessions: ConversationV2SessionService,
  ) {}

  /** Runtime proof: preview issued an AI ticket because the app called the proxy. */
  async markHasAiFeatures(sessionId: string): Promise<void> {
    await this.sessions.setAiFeaturesFlag(sessionId, true, null);
  }

  /**
   * Detect AI usage in a revision and persist the result on the session.
   * Never demotes a prior runtime `true` (e.g. AI preview proxy use) when the
   * static scan misses an import pattern.
   */
  async detectAndPersist(
    sessionId: string,
    workspaceId: string,
    revisionId: string,
  ): Promise<boolean> {
    const detected = await this.detectInRevision(workspaceId, revisionId);
    if (detected) {
      await this.sessions.setAiFeaturesFlag(sessionId, true, revisionId);
      return true;
    }
    return this.sessions.recordAiFeaturesCheckedWithoutDemote(sessionId, revisionId);
  }

  /**
   * Resolve hasAiFeatures for a catalog page. Uses cached session flags when the
   * checked revision still matches; otherwise re-scans (bounded) and persists.
   */
  async resolveForCatalog(
    apps: AppAiFeaturesCatalogInput[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const stale: AppAiFeaturesCatalogInput[] = [];

    for (const app of apps) {
      if (app.hasAiFeatures) {
        result.set(app.sessionId, true);
        continue;
      }
      const revisionId = app.revisionId?.trim() || null;
      if (
        revisionId
        && app.aiFeaturesCheckedRevisionId
        && app.aiFeaturesCheckedRevisionId === revisionId
      ) {
        result.set(app.sessionId, false);
        continue;
      }
      if (!app.workspaceId || !revisionId) {
        result.set(app.sessionId, false);
        continue;
      }
      stale.push(app);
    }

    const toScan = stale.slice(0, MAX_DETECT_PER_LIST);
    await Promise.all(
      toScan.map(async (app) => {
        try {
          const hasAi = await this.detectAndPersist(
            app.sessionId,
            app.workspaceId!,
            app.revisionId!,
          );
          result.set(app.sessionId, hasAi);
        } catch (error) {
          this.logger.warn(
            `AI features detect failed for session ${app.sessionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          result.set(app.sessionId, app.hasAiFeatures);
        }
      }),
    );

    for (const app of stale.slice(MAX_DETECT_PER_LIST)) {
      result.set(app.sessionId, app.hasAiFeatures);
    }

    return result;
  }

  async detectInRevision(workspaceId: string, revisionId: string): Promise<boolean> {
    const { files } = await this.revisions.listFiles(workspaceId, revisionId);
    const candidates = files
      .map((file) => file.path)
      .filter(isScannableSourcePath)
      .slice(0, MAX_FILES_PER_REVISION);

    for (const path of candidates) {
      const text = await this.revisions.readRevisionFileText(
        workspaceId,
        revisionId,
        path,
      );
      if (text && AI_USAGE_RE.test(text)) {
        return true;
      }
    }
    return false;
  }
}
