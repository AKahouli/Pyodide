import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  AppBuilderTemplateCategoryRow,
  AppBuilderTemplateCategoryStore,
  AppBuilderTemplateRevisionRow,
  AppBuilderTemplateRow,
  AppBuilderTemplateStatus,
  AppBuilderTemplateStore,
} from '../app-builder-template.store';
import type { TemplatePlatformReport } from '@modules/app-runtime/platform-kit/platform-template-report';

type CategoryRow = typeof schema.appBuilderTemplateCategories.$inferSelect;
type TemplateRow = typeof schema.appBuilderTemplates.$inferSelect;
type RevisionRow = typeof schema.appBuilderTemplateRevisions.$inferSelect;

function toCategory(row: CategoryRow): AppBuilderTemplateCategoryRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: TemplateRow): AppBuilderTemplateRow {
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    coverImage: row.coverImage,
    revisionId: row.revisionId ?? null,
    manifestObjectKey: row.manifestObjectKey ?? null,
    status: row.status as AppBuilderTemplateStatus,
    platformReport: (row.platformReport as TemplatePlatformReport | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRevision(row: RevisionRow): AppBuilderTemplateRevisionRow {
  return {
    id: row.id,
    templateId: row.templateId,
    revisionId: row.revisionId,
    manifestObjectKey: row.manifestObjectKey,
    manifestHash: row.manifestHash,
    files: Array.isArray(row.files) ? row.files : [],
    fileCount: row.fileCount ?? (Array.isArray(row.files) ? row.files.length : 0),
    status: row.status as AppBuilderTemplateStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgAppBuilderTemplateCategoryStore
  implements AppBuilderTemplateCategoryStore
{
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<AppBuilderTemplateCategoryRow | null> {
    // Category by primary key.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplateCategories)
      .where(eq(schema.appBuilderTemplateCategories.id, id))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findBySlug(slug: string): Promise<AppBuilderTemplateCategoryRow | null> {
    // Public-key lookup for the stable slug.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplateCategories)
      .where(eq(schema.appBuilderTemplateCategories.slug, slug))
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findByNameInsensitive(name: string): Promise<AppBuilderTemplateCategoryRow | null> {
    // Conflict probe so "Guides" and "guides" collide.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplateCategories)
      .where(sql`lower(${schema.appBuilderTemplateCategories.name}) = ${name.trim().toLowerCase()}`)
      .limit(1);
    return row ? toCategory(row) : null;
  }

  async findAll(): Promise<AppBuilderTemplateCategoryRow[]> {
    // Gallery/admin listing ordered by display name.
    const rows = await this.q
      .select()
      .from(schema.appBuilderTemplateCategories)
      .orderBy(asc(schema.appBuilderTemplateCategories.name));
    return rows.map(toCategory);
  }

  async insert(row: { name: string; slug: string; icon: string }): Promise<AppBuilderTemplateCategoryRow> {
    // Create a category; application-generated ObjectId.
    const [inserted] = await this.q
      .insert(schema.appBuilderTemplateCategories)
      .values({ id: newObjectId(), name: row.name, slug: row.slug, icon: row.icon })
      .returning();
    return toCategory(inserted);
  }

  async update(
    id: string,
    patch: { name?: string; slug?: string; icon?: string },
  ): Promise<AppBuilderTemplateCategoryRow | null> {
    // Partial metadata update; only provided fields are written.
    const [row] = await this.q
      .update(schema.appBuilderTemplateCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.appBuilderTemplateCategories.id, id))
      .returning();
    return row ? toCategory(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    // Hard delete; templates cascade via the FK.
    const rows = await this.q
      .delete(schema.appBuilderTemplateCategories)
      .where(eq(schema.appBuilderTemplateCategories.id, id))
      .returning({ id: schema.appBuilderTemplateCategories.id });
    return rows.length > 0;
  }

  async countTemplatesByCategoryIds(ids: string[]): Promise<Map<string, number>> {
    // One grouped count for all requested categories (gallery badges).
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await this.q
      .select({
        categoryId: schema.appBuilderTemplates.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.appBuilderTemplates)
      .where(inArray(schema.appBuilderTemplates.categoryId, ids))
      .groupBy(schema.appBuilderTemplates.categoryId);
    for (const row of rows) out.set(row.categoryId, Number(row.count ?? 0));
    return out;
  }
}

export class PgAppBuilderTemplateStore implements AppBuilderTemplateStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<AppBuilderTemplateRow | null> {
    // Template by primary key.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .where(eq(schema.appBuilderTemplates.id, id))
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async findByRevisionId(revisionId: string): Promise<AppBuilderTemplateRow | null> {
    // RuntimeRevisionService resolves `template_<id>` back to its Ceph manifest.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .where(eq(schema.appBuilderTemplates.revisionId, revisionId))
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async findByCategoryId(categoryId: string): Promise<AppBuilderTemplateRow[]> {
    // Cover/manifest cleanup before a cascade category delete.
    const rows = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .where(eq(schema.appBuilderTemplates.categoryId, categoryId));
    return rows.map(toTemplate);
  }

  async findByCategoryAndTitle(
    categoryId: string,
    title: string,
  ): Promise<AppBuilderTemplateRow | null> {
    // Conflict probe for the (category, title) unique index.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .where(
        and(
          eq(schema.appBuilderTemplates.categoryId, categoryId),
          eq(schema.appBuilderTemplates.title, title),
        ),
      )
      .limit(1);
    return row ? toTemplate(row) : null;
  }

  async listPublished(categoryId?: string): Promise<AppBuilderTemplateRow[]> {
    // User gallery: published only, newest first, optionally one category.
    const conditions = [eq(schema.appBuilderTemplates.status, 'published')];
    if (categoryId) conditions.push(eq(schema.appBuilderTemplates.categoryId, categoryId));
    const rows = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .where(and(...conditions))
      .orderBy(desc(schema.appBuilderTemplates.updatedAt));
    return rows.map(toTemplate);
  }

  async listAll(): Promise<AppBuilderTemplateRow[]> {
    // Admin listing across every status.
    const rows = await this.q
      .select()
      .from(schema.appBuilderTemplates)
      .orderBy(desc(schema.appBuilderTemplates.updatedAt));
    return rows.map(toTemplate);
  }

  async insert(row: {
    categoryId: string;
    title: string;
    description: string;
    coverImage: string;
  }): Promise<AppBuilderTemplateRow> {
    // Create a draft template; publish binds revision/manifest afterwards.
    const [inserted] = await this.q
      .insert(schema.appBuilderTemplates)
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
  ): Promise<AppBuilderTemplateRow | null> {
    // Partial metadata update.
    const [row] = await this.q
      .update(schema.appBuilderTemplates)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.appBuilderTemplates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async setRevision(
    id: string,
    binding: {
      revisionId: string;
      manifestObjectKey: string;
      platformReport?: TemplatePlatformReport;
    },
  ): Promise<AppBuilderTemplateRow | null> {
    // Bind the Ceph manifest to a draft template without publishing it.
    const [row] = await this.q
      .update(schema.appBuilderTemplates)
      .set({
        revisionId: binding.revisionId,
        manifestObjectKey: binding.manifestObjectKey,
        ...(binding.platformReport
          ? { platformReport: binding.platformReport as unknown as Record<string, unknown> }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.appBuilderTemplates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async markPublished(id: string): Promise<AppBuilderTemplateRow | null> {
    const [row] = await this.q
      .update(schema.appBuilderTemplates)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(schema.appBuilderTemplates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async delete(id: string): Promise<AppBuilderTemplateRow | null> {
    // Hard delete; returns the row so callers can clean up its Ceph artifacts.
    const [row] = await this.q
      .delete(schema.appBuilderTemplates)
      .where(eq(schema.appBuilderTemplates.id, id))
      .returning();
    return row ? toTemplate(row) : null;
  }

  async upsertRevision(row: {
    templateId: string;
    revisionId: string;
    manifestObjectKey: string;
    manifestHash: string;
    files: Array<{ path: string; sha256: string; objectKey: string; size: number }>;
  }): Promise<AppBuilderTemplateRevisionRow> {
    // One authoritative row per revision id; re-publish replaces files/status.
    const [upserted] = await this.q
      .insert(schema.appBuilderTemplateRevisions)
      .values({
        id: newObjectId(),
        templateId: row.templateId,
        revisionId: row.revisionId,
        manifestObjectKey: row.manifestObjectKey,
        manifestHash: row.manifestHash,
        files: row.files,
        fileCount: row.files.length,
        status: 'draft',
      })
      .onConflictDoUpdate({
        target: schema.appBuilderTemplateRevisions.revisionId,
        set: {
          templateId: row.templateId,
          manifestObjectKey: row.manifestObjectKey,
          manifestHash: row.manifestHash,
          files: row.files,
          fileCount: row.files.length,
          status: 'draft',
          updatedAt: new Date(),
        },
      })
      .returning();
    return toRevision(upserted);
  }

  async findRevisionByRevisionId(
    revisionId: string,
  ): Promise<AppBuilderTemplateRevisionRow | null> {
    // Revision-id lookup used at runtime resolution time.
    const [row] = await this.q
      .select()
      .from(schema.appBuilderTemplateRevisions)
      .where(eq(schema.appBuilderTemplateRevisions.revisionId, revisionId))
      .limit(1);
    return row ? toRevision(row) : null;
  }

  async markRevisionsPublished(templateId: string): Promise<void> {
    await this.q
      .update(schema.appBuilderTemplateRevisions)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(schema.appBuilderTemplateRevisions.templateId, templateId));
  }

  async listRevisionsByTemplate(templateId: string): Promise<AppBuilderTemplateRevisionRow[]> {
    // Revision history for a template, newest first.
    const rows = await this.q
      .select()
      .from(schema.appBuilderTemplateRevisions)
      .where(eq(schema.appBuilderTemplateRevisions.templateId, templateId))
      .orderBy(desc(schema.appBuilderTemplateRevisions.createdAt));
    return rows.map(toRevision);
  }

  async filterUnreferencedBlobKeys(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const wanted = new Set(candidates);
    const referenced = new Set<string>();

    const mark = (files: Array<{ objectKey?: string }> | null | undefined): void => {
      for (const file of files ?? []) {
        if (file?.objectKey && wanted.has(file.objectKey)) {
          referenced.add(file.objectKey);
        }
      }
    };

    // Remaining template revisions (other catalog entries).
    const templateRows = await this.q
      .select({ files: schema.appBuilderTemplateRevisions.files })
      .from(schema.appBuilderTemplateRevisions);
    for (const row of templateRows) mark(row.files);

    // Workspace revisions share the same content-addressed blob pool.
    const workspaceRows = await this.q
      .select({ files: schema.appRuntimeSourceRevisions.files })
      .from(schema.appRuntimeSourceRevisions);
    for (const row of workspaceRows) mark(row.files);

    return candidates.filter((key) => !referenced.has(key));
  }
}
