import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { appDataApps } from '@modules/postgres/schema/app-data.schema';
import { isObjectId, normalizeObjectId } from '@common/postgres';
import { escapeLike } from '@common/postgres/like';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { USER_STORE, type UserStore } from '../../user/persistence/user.store';
import { AppDataClientService } from '../../app-data/services/app-data-client.service';
import { APP_BUILDER_AI_USAGE_SOURCE } from '../constants';
import { AppBuilderAiSettingsService } from './app-builder-ai-settings.service';
import { AppBuilderAiOfferService } from './app-builder-ai-offer.service';
import { AppBuilderAiUsageService } from './app-builder-ai-usage.service';
import { PgConversationV2SessionStore } from '../../conversation-v2/persistence/postgres/pg-conversation-v2-session.store';

interface AppUsageAgg {
  sessionId: string | null;
  title: string;
  totalTokens: number;
  requestCount: number;
  models: { model: string; totalTokens: number; requestCount: number }[];
}

@Injectable()
export class AppBuilderAiAdminService {
  private readonly logger = new Logger(AppBuilderAiAdminService.name);

  constructor(
    private readonly settings: AppBuilderAiSettingsService,
    private readonly offers: AppBuilderAiOfferService,
    private readonly usage: AppBuilderAiUsageService,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(USER_STORE) private readonly users: UserStore,
    private readonly sessions: PgConversationV2SessionStore,
    @Optional() private readonly appDataClient?: AppDataClientService,
  ) {}

  async getOverview() {
    const settings = await this.settings.getSettings();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [tokenAgg] = await this.db
      .select({
        totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(count(*), 0)`,
        errorCount: sql<number>`coalesce(sum(case when ${schema.usageLogs.success} = false then 1 else 0 end), 0)`,
      })
      .from(schema.usageLogs)
      .where(
        and(
          eq(schema.usageLogs.endpoint, 'ai-proxy.chat-completions'),
          gte(schema.usageLogs.createdAt, since),
          sql`${schema.usageLogs.metadata}->>'source' = ${APP_BUILDER_AI_USAGE_SOURCE}`,
        ),
      );

    const topModels = await this.db
      .select({
        model: schema.usageLogs.modelName,
        totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(count(*), 0)`,
      })
      .from(schema.usageLogs)
      .where(
        and(
          eq(schema.usageLogs.endpoint, 'ai-proxy.chat-completions'),
          gte(schema.usageLogs.createdAt, since),
          sql`${schema.usageLogs.metadata}->>'source' = ${APP_BUILDER_AI_USAGE_SOURCE}`,
        ),
      )
      .groupBy(schema.usageLogs.modelName)
      .orderBy(desc(sql`sum(${schema.usageLogs.totalTokens})`))
      .limit(10);

    const aiAppsCount = await this.sessions.countWithAiFeatures();

    const [offerCount] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.identityUsers)
      .where(isNotNull(schema.identityUsers.appBuilderAiOfferId));

    return {
      enabled: settings.enabled,
      periodHours: 24,
      totalTokens: Number(tokenAgg?.totalTokens ?? 0),
      requestCount: Number(tokenAgg?.requestCount ?? 0),
      errorCount: Number(tokenAgg?.errorCount ?? 0),
      aiAppsCount,
      usersWithOffer: Number(offerCount?.n ?? 0),
      topModels: topModels.map((row) => ({
        model: row.model || 'unknown',
        totalTokens: Number(row.totalTokens ?? 0),
        requestCount: Number(row.requestCount ?? 0),
      })),
    };
  }

  async setEnabled(enabled: boolean) {
    return this.settings.setEnabled(enabled);
  }

  async listUsers(query: {
    q?: string;
    offerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const conditions = [];
    if (query.offerId && isObjectId(query.offerId)) {
      conditions.push(
        eq(schema.identityUsers.appBuilderAiOfferId, normalizeObjectId(query.offerId)),
      );
    }
    if (query.q?.trim()) {
      const pattern = `%${escapeLike(query.q.trim())}%`;
      conditions.push(
        or(
          ilike(schema.identityUsers.email, pattern),
          ilike(schema.identityUsers.firstName, pattern),
          ilike(schema.identityUsers.lastName, pattern),
        ),
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.identityUsers)
      .where(where);
    const total = Number(countRow?.n ?? 0);

    const items = await this.db
      .select({
        id: schema.identityUsers.id,
        email: schema.identityUsers.email,
        firstName: schema.identityUsers.firstName,
        lastName: schema.identityUsers.lastName,
        appBuilderAiOfferId: schema.identityUsers.appBuilderAiOfferId,
        appBuilderAiOfferStartedAt: schema.identityUsers.appBuilderAiOfferStartedAt,
      })
      .from(schema.identityUsers)
      .where(where)
      .orderBy(desc(schema.identityUsers.updatedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const userIds = items.map((u) => u.id);
    const countByOwner = await this.sessions.countWithAiFeaturesByOwners(userIds);

    const offerIds = [
      ...new Set(
        items
          .map((u) => u.appBuilderAiOfferId)
          .filter((id): id is string => !!id),
      ),
    ];
    const offerDocs = await Promise.all(offerIds.map((id) => this.offers.findById(id)));
    const offerById = new Map(
      offerDocs.filter(Boolean).map((o) => [o!.id, o!]),
    );

    const rows = await Promise.all(
      items.map(async (user) => {
        const userId = user.id;
        let status = null as Awaited<ReturnType<AppBuilderAiUsageService['peekStatus']>> | null;
        try {
          status = await this.usage.peekStatus(userId);
        } catch (err) {
          this.logger.warn(
            `peekStatus failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          status = null;
        }
        const offerId = user.appBuilderAiOfferId ?? null;
        const offer = offerId ? offerById.get(offerId) : status?.offer ?? null;
        return {
          userId,
          email: user.email,
          displayName:
            [user.firstName, user.lastName].filter(Boolean).join(' ')
            || null,
          aiAppsCount: countByOwner.get(userId) ?? 0,
          offer: offer
            ? {
                id: offer.id,
                name: offer.name,
                slug: offer.slug,
                tokenLimit: offer.tokenLimit,
              }
            : null,
          usage: status
            ? {
                currentUsage: status.currentUsage,
                limit: status.limit,
                resetsAt: status.resetsAt.toISOString(),
                percentUsed:
                  status.limit < 0
                    ? 0
                    : Math.min(100, Math.round((status.currentUsage / Math.max(1, status.limit)) * 100)),
              }
            : null,
        };
      }),
    );

    return {
      items: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUserDetail(userId: string) {
    if (!isObjectId(userId)) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    const status = await this.usage.getStatus(userId);
    const apps = await this.sessions.listWithAiFeaturesByOwner(userId);

    const since = status.window.windowStart;
    const logs = await this.db
      .select({
        modelName: schema.usageLogs.modelName,
        sessionId: sql<string>`${schema.usageLogs.metadata}->>'sessionId'`,
        workspaceId: sql<string>`${schema.usageLogs.metadata}->>'workspaceId'`,
        appDataId: sql<string>`${schema.usageLogs.metadata}->>'appDataId'`,
        appTitle: sql<string>`${schema.usageLogs.metadata}->>'appTitle'`,
        totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(count(*), 0)`,
      })
      .from(schema.usageLogs)
      .where(
        and(
          eq(schema.usageLogs.userId, userId),
          eq(schema.usageLogs.endpoint, 'ai-proxy.chat-completions'),
          gte(schema.usageLogs.createdAt, since),
          sql`${schema.usageLogs.metadata}->>'source' = ${APP_BUILDER_AI_USAGE_SOURCE}`,
        ),
      )
      .groupBy(
        schema.usageLogs.modelName,
        sql`${schema.usageLogs.metadata}->>'sessionId'`,
        sql`${schema.usageLogs.metadata}->>'workspaceId'`,
        sql`${schema.usageLogs.metadata}->>'appDataId'`,
        sql`${schema.usageLogs.metadata}->>'appTitle'`,
      );

    const byApp = new Map<string, AppUsageAgg>();
    const byModel = new Map<string, { model: string; totalTokens: number; requestCount: number }>();
    let unattributedTokens = 0;
    let unattributedRequests = 0;

    for (const row of logs) {
      const tokens = Number(row.totalTokens ?? 0);
      const requests = Number(row.requestCount ?? 0);
      const model = row.modelName || 'unknown';
      const modelAgg = byModel.get(model) ?? { model, totalTokens: 0, requestCount: 0 };
      modelAgg.totalTokens += tokens;
      modelAgg.requestCount += requests;
      byModel.set(model, modelAgg);

      const key = row.sessionId || row.workspaceId || row.appDataId || '';
      if (!key) {
        unattributedTokens += tokens;
        unattributedRequests += requests;
        continue;
      }
      this.mergeAppUsage(byApp, key, {
        sessionId: row.sessionId || null,
        title: row.appTitle || 'Untitled app',
        totalTokens: tokens,
        requestCount: requests,
        model,
      });
    }

    const workspaceIds = apps
      .map((app) => app.aiSessionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const appDataIdByWorkspace = await this.resolveAppDataIdsByWorkspace(workspaceIds);

    return {
      user: {
        userId,
        email: user.email,
        displayName:
          [user.firstName, user.lastName].filter(Boolean).join(' ')
          || null,
      },
      offer: {
        id: status.offer.id,
        name: status.offer.name,
        slug: status.offer.slug,
        tokenLimit: status.offer.tokenLimit,
        windowHours: status.offer.windowHours,
        startedAt: user.appBuilderAiOfferStartedAt
          ? new Date(user.appBuilderAiOfferStartedAt).toISOString()
          : null,
      },
      usage: {
        currentUsage: status.currentUsage,
        limit: status.limit,
        resetsAt: status.resetsAt.toISOString(),
        windowStart: status.window.windowStart.toISOString(),
        requestCount: status.window.requestCount,
      },
      apps: apps.map((app) => {
        const sessionId = app.id;
        const appDataId = app.aiSessionId
          ? appDataIdByWorkspace.get(app.aiSessionId)
          : undefined;
        const usageRow = this.mergeUsageRows(
          byApp.get(sessionId),
          app.aiSessionId ? byApp.get(app.aiSessionId) : undefined,
          appDataId ? byApp.get(appDataId) : undefined,
        );
        return {
          sessionId,
          title: app.deployedAppTitle || app.title || 'Untitled app',
          deployStatus: app.deployStatus,
          deployedUrl: app.deployedUrl,
          totalTokens: usageRow?.totalTokens ?? 0,
          requestCount: usageRow?.requestCount ?? 0,
          models: usageRow?.models ?? [],
        };
      }),
      byModel: [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      unattributed: {
        totalTokens: unattributedTokens,
        requestCount: unattributedRequests,
      },
    };
  }

  private async resolveAppDataIdsByWorkspace(
    workspaceIds: string[],
  ): Promise<Map<string, string>> {
    const appDataIdByWorkspace = new Map<string, string>();
    if (workspaceIds.length === 0) return appDataIdByWorkspace;

    try {
      const catalogRows = await this.db
        .select({
          workspaceId: appDataApps.workspaceId,
          appDataId: appDataApps.appDataId,
        })
        .from(appDataApps)
        .where(inArray(appDataApps.workspaceId, workspaceIds));
      for (const row of catalogRows) {
        appDataIdByWorkspace.set(row.workspaceId, row.appDataId);
      }
    } catch (err) {
      this.logger.warn(
        `Local app_data_apps lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!this.appDataClient?.isEnabled()) {
      return appDataIdByWorkspace;
    }

    const missing = workspaceIds.filter((id) => !appDataIdByWorkspace.has(id));
    await Promise.all(
      missing.map(async (workspaceId) => {
        try {
          const app = await this.appDataClient!.getAppByWorkspace(workspaceId);
          if (app?.id) {
            appDataIdByWorkspace.set(workspaceId, app.id);
          }
        } catch (err) {
          this.logger.warn(
            `Remote appDataId lookup failed for workspace ${workspaceId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }),
    );

    return appDataIdByWorkspace;
  }

  private mergeAppUsage(
    byApp: Map<string, AppUsageAgg>,
    key: string,
    row: {
      sessionId: string | null;
      title: string;
      totalTokens: number;
      requestCount: number;
      model: string;
    },
  ): void {
    const app = byApp.get(key) ?? {
      sessionId: row.sessionId,
      title: row.title,
      totalTokens: 0,
      requestCount: 0,
      models: [],
    };
    if (!app.sessionId && row.sessionId) app.sessionId = row.sessionId;
    if ((!app.title || app.title === 'Untitled app') && row.title) {
      app.title = row.title;
    }
    app.totalTokens += row.totalTokens;
    app.requestCount += row.requestCount;
    const existingModel = app.models.find((m) => m.model === row.model);
    if (existingModel) {
      existingModel.totalTokens += row.totalTokens;
      existingModel.requestCount += row.requestCount;
    } else {
      app.models.push({
        model: row.model,
        totalTokens: row.totalTokens,
        requestCount: row.requestCount,
      });
    }
    byApp.set(key, app);
  }

  /** Combine usage keyed by sessionId, workspaceId, and/or appDataId for one app. */
  private mergeUsageRows(
    ...rows: (AppUsageAgg | undefined)[]
  ): AppUsageAgg | undefined {
    const present = rows.filter((r): r is AppUsageAgg => !!r);
    if (present.length === 0) return undefined;
    if (present.length === 1) return present[0];

    const merged: AppUsageAgg = {
      sessionId: present.find((r) => r.sessionId)?.sessionId ?? null,
      title: present.find((r) => r.title && r.title !== 'Untitled app')?.title
        ?? present[0].title,
      totalTokens: 0,
      requestCount: 0,
      models: [],
    };
    for (const row of present) {
      merged.totalTokens += row.totalTokens;
      merged.requestCount += row.requestCount;
      for (const model of row.models) {
        const existing = merged.models.find((m) => m.model === model.model);
        if (existing) {
          existing.totalTokens += model.totalTokens;
          existing.requestCount += model.requestCount;
        } else {
          merged.models.push({ ...model });
        }
      }
    }
    return merged;
  }

  async getAppDetail(userId: string, sessionId: string) {
    const detail = await this.getUserDetail(userId);
    const app = detail.apps.find((a) => a.sessionId === sessionId);
    if (!app) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'AI app not found for this user');
    }
    return {
      user: detail.user,
      app,
      byModel: app.models,
    };
  }

  async assignOffer(userId: string, offerId: string) {
    if (!isObjectId(userId)) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }
    await this.usage.assignOffer(userId, offerId);
    return this.getUserDetail(userId);
  }
}
