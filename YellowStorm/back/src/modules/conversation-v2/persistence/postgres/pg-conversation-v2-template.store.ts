import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  ConversationV2TemplateCategoryRow,
  ConversationV2TemplateCategoryStore,
  ConversationV2TemplateRow,
  ConversationV2TemplateStatus,
  ConversationV2TemplateStore,
} from '../conversation-v2-template.store';

type CategoryRow = typeof schema.conversationV2TemplateCategories.$inferSelect;
type TemplateRow = typeof schema.conversationV2Templates.$inferSelect;

function toCategory(row: CategoryRow): ConversationV2TemplateCategoryRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: TemplateRow): ConversationV2TemplateRow {
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    coverImage: row.coverImage,
    revisionId: row.revisionId ?? null,
    manifestObjectKey: row.manifestObjectKey ?? null,
    status: row.status as ConversationV2TemplateStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgConversationV2TemplateCategoryStore
  implements ConversationV2TemplateCategoryStore
{
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ConversationV2TemplateCategoryRow | null> {
    // Category by primary key.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2TemplateCategories)
      .where(eq(schema.conversationV2TemplateCategories.id, id))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findBySlug(slug: string): Promise<ConversationV2TemplateCategoryRow | null> {
    // Public-key lookup for the stable slug.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2TemplateCategories)
      .where(eq(schema.conversationV2TemplateCategories.slug, slug))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findByNameInsensitive(name: string): Promise<ConversationV2TemplateCategoryRow | null> {
    // Conflict probe so "Guides" and "guides" collide.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2TemplateCategories)
      .where(sql`lower(${schema.conversationV2TemplateCategories.name}) = ${name.trim().toLowerCase()}`)
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findAll(): Promise<ConversationV2TemplateCategoryRow[]> {
    // Gallery/admin listing ordered by display name.
    const rows = await this.q
      .select()
      .from(schema.conversationV2TemplateCategories)
      .orderBy(asc(schema.conversationV2TemplateCategories.name));
    return rows.map(toCategory);
  }

  async insert(row: { name: string; slug: string; icon: string }): Promise<ConversationV2TemplateCategoryRow> {
    // Create a category; application-generated ObjectId.
    const [inserted] = await this.q
      .insert(schema.conversationV2TemplateCategories)
      .values({ id: newObjectId(), name: row.name, slug: row.slug, icon: row.icon })
      .returning();
    return toCategory(inserted);
  }

  async update(
    id: string,
    patch: { name?: string; slug?: string; icon?: string },
  ): Promise<ConversationV2TemplateCategoryRow | null> {
    // Partial metadata update; only provided fields are written.
    const [row] = await this.q
      .update(schema.conversationV2TemplateCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.conversationV2TemplateCategories.id, id))
      .returning();
    return row ? toCategory(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    // Hard delete; templates cascade via the FK.
    const rows = await this.q
      .delete(schema.conversationV2TemplateCategories)
      .where(eq(schema.conversationV2TemplateCategories.id, id))
      .returning({ id: schema.conversationV2TemplateCategories.id });
    return rows.length > 0;
  }

  async countTemplatesByCategoryIds(ids: string[]): Promise<Map<string, number>> {
    // One grouped count for all requested categories (gallery badges).
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await this.q
      .select({
        categoryId: schema.conversationV2Templates.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.conversationV2Templates)
      .where(inArray(schema.conversationV2Templates.categoryId, ids))
      .groupBy(schema.conversationV2Templates.categoryId);
    for (const row of rows) out.set(row.categoryId, Number(row.count ?? 0));
    return out;
  }
}

export class PgConversationV2TemplateStore implements ConversationV2TemplateStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ConversationV2TemplateRow | null> {
    // Template by primary key.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .where(eq(schema.conversationV2Templates.id, id))
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async findByRevisionId(revisionId: string): Promise<ConversationV2TemplateRow | null> {
    // RuntimeRevisionService resolves `template_<id>` back to its Ceph manifest.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .where(eq(schema.conversationV2Templates.revisionId, revisionId))
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async findByCategoryId(categoryId: string): Promise<ConversationV2TemplateRow[]> {
    // Cover/manifest cleanup before a cascade category delete.
    const rows = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .where(eq(schema.conversationV2Templates.categoryId, categoryId));
    return rows.map(toTemplate);
  }

  async findByCategoryAndTitle(
    categoryId: string,
    title: string,
  ): Promise<ConversationV2TemplateRow | null> {
    // Conflict probe for the (category, title) unique index.
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .where(
        and(
          eq(schema.conversationV2Templates.categoryId, categoryId),
          eq(schema.conversationV2Templates.title, title),
        ),
      )
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async listPublished(categoryId?: string): Promise<ConversationV2TemplateRow[]> {
    // User gallery: published only, newest first, optionally one category.
    const conditions = [eq(schema.conversationV2Templates.status, 'published')];
    if (categoryId) conditions.push(eq(schema.conversationV2Templates.categoryId, categoryId));
    const rows = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .where(and(...conditions))
      .orderBy(desc(schema.conversationV2Templates.updatedAt));
    return rows.map(toTemplate);
  }

  async listAll(): Promise<ConversationV2TemplateRow[]> {
    // Admin listing across every status.
    const rows = await this.q
      .select()
      .from(schema.conversationV2Templates)
      .orderBy(desc(schema.conversationV2Templates.updatedAt));
    return rows.map(toTemplate);
  }

  async insert(row: {
    categoryId: string;
    title: string;
    description: string;
    coverImage: string;
  }): Promise<ConversationV2TemplateRow> {
    // Create a draft template; publish binds revision/manifest afterwards.
    const [inserted] = await this.q
      .insert(schema.conversationV2Templates)
      .values({
        id: newObjectId(),
        categoryId: row.categoryId,
        title: row.title,
        description: row.description,
        coverImage: row.coverImage,
        revisionId: null,
        manifestObjectKey: null,
        status: 'draft',
      })
      .returning();
    return toTemplate(inserted);
  }

  async update(
    id: string,
    patch: { categoryId?: string; title?: string; description?: string; coverImage?: string },
  ): Promise<ConversationV2TemplateRow | null> {
    // Partial metadata update.
    const [row] = await this.q
      .update(schema.conversationV2Templates)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.conversationV2Templates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async setPublished(
    id: string,
    binding: { revisionId: string; manifestObjectKey: string },
  ): Promise<ConversationV2TemplateRow | null> {
    // Bind the Ceph manifest and flip the template to published.
    const [row] = await this.q
      .update(schema.conversationV2Templates)
      .set({
        revisionId: binding.revisionId,
        manifestObjectKey: binding.manifestObjectKey,
        status: 'published',
        updatedAt: new Date(),
      })
      .where(eq(schema.conversationV2Templates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async delete(id: string): Promise<ConversationV2TemplateRow | null> {
    // Hard delete; returns the row so callers can clean up its Ceph artifacts.
    const [row] = await this.q
      .delete(schema.conversationV2Templates)
      .where(eq(schema.conversationV2Templates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }
}
