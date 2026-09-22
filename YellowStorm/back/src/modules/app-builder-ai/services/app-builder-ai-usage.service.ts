import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Model, Types } from 'mongoose';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newOwnedId } from '@modules/conversation/persistence/owned-id';
import { User, UserDocument } from '../../user/schemas/user.schema';
import { UsageType } from '../../usage/usage-type.enum';
import { APP_BUILDER_AI_USAGE_SOURCE } from '../constants';
import { AppBuilderAiOfferService } from './app-builder-ai-offer.service';
import type { AppBuilderAiOfferDocument } from '../schemas/app-builder-ai-offer.schema';

export interface AppBuilderAiUsageWindow {
  id: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  windowHours: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  offerId: string | null;
  offerSlug: string | null;
  tokenLimitAtCreation: number | null;
}

export interface AppBuilderAiUsageCheck {
  allowed: boolean;
  currentUsage: number;
  limit: number;
  resetsAt: Date;
  offer: AppBuilderAiOfferDocument;
}

export interface RecordAppBuilderAiUsageParams {
  userId: string;
  inputTokens: number;
  outputTokens: number;
  modelName?: string;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AppBuilderAiUsageService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly offers: AppBuilderAiOfferService,
  ) {}

  async ensureUserHasOffer(userId: string): Promise<AppBuilderAiOfferDocument> {
    const user = await this.users.findById(userId).select('appBuilderAiOfferId').lean().exec();
    if (user?.appBuilderAiOfferId) {
      const offer = await this.offers.findById(user.appBuilderAiOfferId.toString());
      if (offer && offer.isActive) return offer;
    }
    const def = await this.offers.getDefaultOffer();
    await this.assignOffer(userId, def._id.toString());
    return def;
  }

  async assignOffer(userId: string, offerId: string): Promise<void> {
    const offer = await this.offers.requireById(offerId);
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          appBuilderAiOfferId: offer._id,
          appBuilderAiOfferStartedAt: new Date(),
        },
      },
    );
  }

  async checkLimit(
    userId: string,
    estimatedTokens = 0,
  ): Promise<AppBuilderAiUsageCheck> {
    const offer = await this.ensureUserHasOffer(userId);
    const window = await this.getOrCreateCurrentWindow(userId, offer);
    const limit = offer.tokenLimit;
    const currentUsage = window.totalTokens;
    const allowed =
      limit < 0 || currentUsage + Math.max(0, estimatedTokens) <= limit;
    return {
      allowed,
      currentUsage,
      limit,
      resetsAt: window.windowEnd,
      offer,
    };
  }

  async getStatus(userId: string): Promise<AppBuilderAiUsageCheck & { window: AppBuilderAiUsageWindow }> {
    const check = await this.checkLimit(userId);
    const window = await this.getOrCreateCurrentWindow(userId, check.offer);
    return { ...check, window };
  }

  /**
   * Read-only status for admin lists: never assigns a default offer.
   * Returns null when the user has no active App Builder AI offer.
   */
  async peekStatus(
    userId: string,
  ): Promise<(AppBuilderAiUsageCheck & { window: AppBuilderAiUsageWindow }) | null> {
    const user = await this.users.findById(userId).select('appBuilderAiOfferId').lean().exec();
    if (!user?.appBuilderAiOfferId) return null;
    const offer = await this.offers.findById(user.appBuilderAiOfferId.toString());
    if (!offer || !offer.isActive) return null;
    const window = await this.getOrCreateCurrentWindow(userId, offer);
    const limit = offer.tokenLimit;
    const currentUsage = window.totalTokens;
    const allowed = limit < 0 || currentUsage <= limit;
    return {
      allowed,
      currentUsage,
      limit,
      resetsAt: window.windowEnd,
      offer,
      window,
    };
  }

  async recordUsage(params: RecordAppBuilderAiUsageParams): Promise<AppBuilderAiUsageWindow> {
    const offer = await this.ensureUserHasOffer(params.userId);
    const totalTokens = params.inputTokens + params.outputTokens;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ab_ai:${params.userId}`}))`);
      const now = new Date();
      const activeRows = await tx
        .select()
        .from(schema.appBuilderAiUsageWindows)
        .where(
          and(
            eq(schema.appBuilderAiUsageWindows.userId, params.userId),
            lte(schema.appBuilderAiUsageWindows.windowStart, now),
            gt(schema.appBuilderAiUsageWindows.windowEnd, now),
          ),
        )
        .orderBy(desc(schema.appBuilderAiUsageWindows.windowStart))
        .limit(1);
      const window = activeRows.length
        ? activeRows[0]
        : (
            await tx
              .insert(schema.appBuilderAiUsageWindows)
              .values(this.windowValues(params.userId, offer, now))
              .returning()
          )[0];
      const [updated] = await tx
        .update(schema.appBuilderAiUsageWindows)
        .set({
          inputTokens: sql`${schema.appBuilderAiUsageWindows.inputTokens} + ${params.inputTokens}`,
          outputTokens: sql`${schema.appBuilderAiUsageWindows.outputTokens} + ${params.outputTokens}`,
          totalTokens: sql`${schema.appBuilderAiUsageWindows.totalTokens} + ${totalTokens}`,
          requestCount: sql`${schema.appBuilderAiUsageWindows.requestCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.appBuilderAiUsageWindows.id, window.id))
        .returning();

      await tx.insert(schema.usageLogs).values({
        id: newOwnedId(),
        userId: params.userId,
        usageType: UsageType.CHAT,
        modelName: params.modelName,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens,
        durationMs: params.durationMs,
        endpoint: 'ai-proxy.chat-completions',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        success: params.success ?? true,
        errorCode: params.errorCode,
        metadata: {
          source: APP_BUILDER_AI_USAGE_SOURCE,
          ...(params.metadata ?? {}),
        },
      });

      return this.mapWindow(updated);
    });
  }

  async getOrCreateCurrentWindow(
    userId: string,
    offer: AppBuilderAiOfferDocument,
  ): Promise<AppBuilderAiUsageWindow> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ab_ai:${userId}`}))`);
      const now = new Date();
      const activeRows = await tx
        .select()
        .from(schema.appBuilderAiUsageWindows)
        .where(
          and(
            eq(schema.appBuilderAiUsageWindows.userId, userId),
            lte(schema.appBuilderAiUsageWindows.windowStart, now),
            gt(schema.appBuilderAiUsageWindows.windowEnd, now),
          ),
        )
        .orderBy(desc(schema.appBuilderAiUsageWindows.windowStart))
        .limit(1);
      if (activeRows.length) return this.mapWindow(activeRows[0]);
      const [created] = await tx
        .insert(schema.appBuilderAiUsageWindows)
        .values(this.windowValues(userId, offer, now))
        .returning();
      return this.mapWindow(created);
    });
  }

  private windowValues(userId: string, offer: AppBuilderAiOfferDocument, now: Date) {
    const hours = Math.max(1, offer.windowHours || 24);
    const windowEnd = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return {
      id: newOwnedId(),
      userId,
      windowStart: now,
      windowEnd,
      windowHours: hours,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      offerId: offer._id.toString(),
      offerSlug: offer.slug,
      tokenLimitAtCreation: offer.tokenLimit,
    };
  }

  private mapWindow(row: typeof schema.appBuilderAiUsageWindows.$inferSelect): AppBuilderAiUsageWindow {
    return {
      id: row.id,
      userId: row.userId,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      windowHours: row.windowHours,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      requestCount: row.requestCount,
      offerId: row.offerId ?? null,
      offerSlug: row.offerSlug ?? null,
      tokenLimitAtCreation: row.tokenLimitAtCreation ?? null,
    };
  }
}
