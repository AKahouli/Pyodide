import { Injectable, Logger } from '@nestjs/common';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { detectRevisionUsesAi } from '../utils/app-builder-revision-ai-usage';
import { AppBuilderSessionService } from './app-builder-session.service';

/** Bound catalog rescans so a large hub page stays responsive. */
const MAX_DETECT_PER_LIST = 48;

export interface AppAiFeaturesCatalogInput {
  sessionId: string;
  workspaceId: string | null;
  /** Preferred revision to inspect (deployed, else latest finalized). */
  revisionId: string | null;
  hasAiFeatures: boolean;
  aiFeaturesCheckedRevisionId: string | null;
}

@Injectable()
export class AppBuilderAppAiFeaturesService {
  private readonly logger = new Logger(AppBuilderAppAiFeaturesService.name);

  constructor(
    private readonly revisions: RuntimeRevisionService,
    private readonly sessions: AppBuilderSessionService,
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
    return detectRevisionUsesAi(this.revisions, workspaceId, revisionId);
  }
}
