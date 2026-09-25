import { Inject } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId, isObjectId, normalizeObjectId } from '@common/postgres';
import { isUniqueViolation } from '@common/postgres/errors';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import { ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  type AppBuilderAiOfferRecord,
  type AppBuilderAiOfferStore,
  type CreateAppBuilderAiOfferData,
  type UpdateAppBuilderAiOfferData,
} from './app-builder-ai-offer.store';

type Row = typeof schema.catalogAppBuilderAiOffers.$inferSelect;

function toRecord(row: Row): AppBuilderAiOfferRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    tokenLimit: Number(row.tokenLimit),
    windowHours: row.windowHours,
    requestsPerMinute: row.requestsPerMinute,
    maxTokensPerRequest: Number(row.maxTokensPerRequest),
    priority: row.priority,
    isActive: row.isActive,
    isDefault: row.isDefault,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toValues(
  data: CreateAppBuilderAiOfferData | UpdateAppBuilderAiOfferData,
): Partial<typeof schema.catalogAppBuilderAiOffers.$inferInsert> {
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => v !== undefined && k !== 'id'),
  ) as Partial<typeof schema.catalogAppBuilderAiOffers.$inferInsert>;
  if (typeof data.slug === 'string') cleaned.slug = data.slug.trim().toLowerCase();
  return cleaned;
}

export class PgAppBuilderAiOfferStore implements AppBuilderAiOfferStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async list(includeInactive = true): Promise<AppBuilderAiOfferRecord[]> {
    const rows = includeInactive
      ? await this.q
          .select()
          .from(schema.catalogAppBuilderAiOffers)
          .orderBy(
            asc(schema.catalogAppBuilderAiOffers.displayOrder),
            asc(schema.catalogAppBuilderAiOffers.priority),
          )
      : await this.q
          .select()
          .from(schema.catalogAppBuilderAiOffers)
          .where(eq(schema.catalogAppBuilderAiOffers.isActive, true))
          .orderBy(
            asc(schema.catalogAppBuilderAiOffers.displayOrder),
            asc(schema.catalogAppBuilderAiOffers.priority),
          );
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<AppBuilderAiOfferRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .select()
      .from(schema.catalogAppBuilderAiOffers)
      .where(eq(schema.catalogAppBuilderAiOffers.id, normalizeObjectId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<AppBuilderAiOfferRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAppBuilderAiOffers)
      .where(eq(schema.catalogAppBuilderAiOffers.slug, slug.trim().toLowerCase()))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findFlaggedDefault(): Promise<AppBuilderAiOfferRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAppBuilderAiOffers)
      .where(
        and(
          eq(schema.catalogAppBuilderAiOffers.isDefault, true),
          eq(schema.catalogAppBuilderAiOffers.isActive, true),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findFirstActive(): Promise<AppBuilderAiOfferRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAppBuilderAiOffers)
      .where(eq(schema.catalogAppBuilderAiOffers.isActive, true))
      .orderBy(asc(schema.catalogAppBuilderAiOffers.displayOrder))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async seed(data: CreateAppBuilderAiOfferData): Promise<void> {
    await this.q
      .insert(schema.catalogAppBuilderAiOffers)
      .values({
        id: data.id && isObjectId(data.id) ? normalizeObjectId(data.id) : newObjectId(),
        name: data.name,
        slug: data.slug.trim().toLowerCase(),
        description: data.description ?? null,
        tokenLimit: data.tokenLimit,
        windowHours: data.windowHours,
        requestsPerMinute: data.requestsPerMinute ?? 60,
        maxTokensPerRequest: data.maxTokensPerRequest ?? -1,
        priority: data.priority ?? 0,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false,
        displayOrder: data.displayOrder ?? 0,
      })
      .onConflictDoNothing({ target: schema.catalogAppBuilderAiOffers.slug });
  }

  async insert(data: CreateAppBuilderAiOfferData): Promise<AppBuilderAiOfferRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        if (data.isDefault) {
          await tx
            .update(schema.catalogAppBuilderAiOffers)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(schema.catalogAppBuilderAiOffers.isDefault, true));
        }
        const [row] = await tx
          .insert(schema.catalogAppBuilderAiOffers)
          .values({
            id: data.id && isObjectId(data.id) ? normalizeObjectId(data.id) : newObjectId(),
            name: data.name,
            slug: data.slug.trim().toLowerCase(),
            description: data.description ?? null,
            tokenLimit: data.tokenLimit,
            windowHours: data.windowHours,
            requestsPerMinute: data.requestsPerMinute ?? 60,
            maxTokensPerRequest: data.maxTokensPerRequest ?? -1,
            priority: data.priority ?? 0,
            isActive: data.isActive ?? true,
            isDefault: data.isDefault ?? false,
            displayOrder: data.displayOrder ?? 0,
          })
          .returning();
        return toRecord(row);
      });
    } catch (error) {
      if (
        isUniqueViolation(error, 'uq_ab_ai_offers_slug')
        || isUniqueViolation(error, 'uq_ab_ai_offers_name')
      ) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Offer name or slug already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    patch: UpdateAppBuilderAiOfferData,
  ): Promise<AppBuilderAiOfferRecord | null> {
    if (!isObjectId(id)) return null;
    try {
      return await withTransaction(this.db, async (tx) => {
        if (patch.isDefault === true) {
          await tx
            .update(schema.catalogAppBuilderAiOffers)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                ne(schema.catalogAppBuilderAiOffers.id, normalizeObjectId(id)),
                eq(schema.catalogAppBuilderAiOffers.isDefault, true),
              ),
            );
        }
        const [row] = await tx
          .update(schema.catalogAppBuilderAiOffers)
          .set({ ...toValues(patch), updatedAt: new Date() })
          .where(eq(schema.catalogAppBuilderAiOffers.id, normalizeObjectId(id)))
          .returning();
        return row ? toRecord(row) : null;
      });
    } catch (error) {
      if (
        isUniqueViolation(error, 'uq_ab_ai_offers_slug')
        || isUniqueViolation(error, 'uq_ab_ai_offers_name')
      ) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Offer name or slug already exists');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!isObjectId(id)) return false;
    const rows = await this.q
      .delete(schema.catalogAppBuilderAiOffers)
      .where(eq(schema.catalogAppBuilderAiOffers.id, normalizeObjectId(id)))
      .returning({ id: schema.catalogAppBuilderAiOffers.id });
    return rows.length > 0;
  }
}
