import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { escapeLike } from '@common/postgres/like';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  SKILL_STORE, 
  type NewSkillRow, 
  type SkillCategoryRow, 
  type SkillCategoryStore, 
  type SkillFileRow, 
  type SkillListQuery, 
  type SkillRow, 
  type SkillStore, 
} from './skill.store';

type CategoryT = typeof schema.catalogSkillCategories.$inferSelect;
type SkillT = typeof schema.catalogSkills.$inferSelect;
type FileT = typeof schema.catalogSkillFiles.$inferSelect;

function categoryToRow(r: CategoryT): SkillCategoryRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function fileToRow(r: FileT): SkillFileRow {
  return {
    id: r.id,
    path: r.path,
    kind: r.kind,
    mimeType: r.mimeType ?? '',
    content: r.content,
    position: r.position,
  };
}

function skillToRow(r: SkillT, files: SkillFileRow[]): SkillRow {
  return {
    id: r.id,
    slug: r.slug ?? null,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    iconColor: r.iconColor ?? 'light',
    categoryId: r.categoryId ?? null,
    license: r.license ?? '',
    compatibility: r.compatibility ?? '',
    metadata: (r.metadata ?? {}) as Record<string, string>,
    allowedTools: r.allowedTools ?? [],
    instructions: r.instructions ?? '',
    files,
    isActive: r.isActive,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgSkillCategoryStore implements SkillCategoryStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findAll(): Promise<SkillCategoryRow[]> {
    const rows = await this.q.select().from(schema.catalogSkillCategories).orderBy(asc(schema.catalogSkillCategories.name));
    return rows.map(categoryToRow);
  }

  async findById(id: string): Promise<SkillCategoryRow | null> {
    const [row] = await this.q.select().from(schema.catalogSkillCategories).where(eq(schema.catalogSkillCategories.id, id)).limit(1);
    return row ? categoryToRow(row) : null;
  }

  async findByNameInsensitive(name: string): Promise<SkillCategoryRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogSkillCategories)
      .where(sql`lower(${schema.catalogSkillCategories.name}) = ${name.toLowerCase()}`)
      .limit(1);
    return row ? categoryToRow(row) : null;
  }

  async ensureSystem(data: { name: string; description: string }): Promise<void> {
    await this.q
      .insert(schema.catalogSkillCategories)
      .values({ id: newObjectId(), ...data, isSystem: true })
      .onConflictDoUpdate({
        target: schema.catalogSkillCategories.name,
        set: { isSystem: true, updatedAt: new Date() },
      });
  }

  async insert(data: { name: string; description: string; isSystem?: boolean }): Promise<SkillCategoryRow> {
    const [row] = await this.q
      .insert(schema.catalogSkillCategories)
      .values({ id: newObjectId(), ...data, isSystem: data.isSystem ?? false })
      .returning();
    return categoryToRow(row);
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<SkillCategoryRow | null> {
    const [row] = await this.q
      .update(schema.catalogSkillCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.catalogSkillCategories.id, id))
      .returning();
    return row ? categoryToRow(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.q
      .delete(schema.catalogSkillCategories)
      .where(eq(schema.catalogSkillCategories.id, id))
      .returning({ id: schema.catalogSkillCategories.id });
    return rows.length > 0;
  }

  async findNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.q
      .select({ id: schema.catalogSkillCategories.id, name: schema.catalogSkillCategories.name })
      .from(schema.catalogSkillCategories)
      .where(inArray(schema.catalogSkillCategories.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

export class PgSkillStore implements SkillStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private async filesFor(skillIds: string[]): Promise<Map<string, SkillFileRow[]>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.q
      .select()
      .from(schema.catalogSkillFiles)
      .where(inArray(schema.catalogSkillFiles.skillId, skillIds))
      .orderBy(asc(schema.catalogSkillFiles.position), asc(schema.catalogSkillFiles.id));
    const map = new Map<string, SkillFileRow[]>();
    for (const row of rows) {
      const list = map.get(row.skillId) ?? [];
      list.push(fileToRow(row));
      map.set(row.skillId, list);
    }
    return map;
  }

  async findById(id: string): Promise<SkillRow | null> {
    const [row] = await this.q.select().from(schema.catalogSkills).where(eq(schema.catalogSkills.id, id)).limit(1);
    if (!row) return null;
    const files = await this.filesFor([row.id]);
    return skillToRow(row, files.get(row.id) ?? []);
  }

  async findByIds(ids: string[]): Promise<SkillRow[]> {
    if (ids.length === 0) return [];
    const [rows, files] = await Promise.all([
      this.q
        .select()
        .from(schema.catalogSkills)
        .where(and(inArray(schema.catalogSkills.id, ids), eq(schema.catalogSkills.isActive, true)))
        .orderBy(asc(schema.catalogSkills.name)),
      this.filesFor(ids),
    ]);
    return rows.map((row) => skillToRow(row, files.get(row.id) ?? []));
  }

  async list(query: SkillListQuery): Promise<{ rows: SkillRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(or(ilike(schema.catalogSkills.name, pattern), ilike(schema.catalogSkills.description, pattern))!);
    }
    if (query.isActive !== undefined) conditions.push(eq(schema.catalogSkills.isActive, query.isActive));
    const filter = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [tally]] = await Promise.all([
      this.q
        .select()
        .from(schema.catalogSkills)
        .where(filter)
        .orderBy(desc(schema.catalogSkills.createdAt))
        .offset((query.page - 1) * query.limit)
        .limit(query.limit),
      this.q.select({ n: sql<number>`count(*)::int` }).from(schema.catalogSkills).where(filter),
    ]);

    return { rows: rows.map((row) => skillToRow(row, [])), total: tally?.n ?? 0 };
  }

  async findAllActive(): Promise<SkillRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(eq(schema.catalogSkills.isActive, true))
      .orderBy(asc(schema.catalogSkills.name));
    return rows.map((row) => skillToRow(row, []));
  }

  async findByOwnerNameOrSlug(createdBy: string, name: string, slug: string): Promise<SkillRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(and(eq(schema.catalogSkills.createdBy, createdBy), or(eq(schema.catalogSkills.name, name), eq(schema.catalogSkills.slug, slug))))
      .limit(1);
    return row ? skillToRow(row, []) : null;
  }

  async findByOwnerSlug(createdBy: string, slug: string): Promise<SkillRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(and(eq(schema.catalogSkills.createdBy, createdBy), eq(schema.catalogSkills.slug, slug)))
      .limit(1);
    return row ? skillToRow(row, []) : null;
  }

  async findIdsBySlugs(createdBy: string, slugs: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (slugs.length === 0) return map;
    const rows = await this.q
      .select({ id: schema.catalogSkills.id, slug: schema.catalogSkills.slug })
      .from(schema.catalogSkills)
      .where(and(eq(schema.catalogSkills.createdBy, createdBy), inArray(schema.catalogSkills.slug, slugs)));
    for (const row of rows) {
      if (row.slug) map.set(row.slug, row.id);
    }
    return map;
  }

  async findAllExport(ids?: string[]): Promise<SkillRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(ids && ids.length > 0 ? inArray(schema.catalogSkills.id, ids) : undefined)
      .orderBy(asc(schema.catalogSkills.name));
    const files = await this.filesFor(rows.map((row) => row.id));
    return rows.map((row) => skillToRow(row, files.get(row.id) ?? []));
  }

  async findByOwnerNameExcluding(createdBy: string, excludeId: string, name: string): Promise<SkillRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(and(
        eq(schema.catalogSkills.createdBy, createdBy),
        ne(schema.catalogSkills.id, excludeId),
        eq(schema.catalogSkills.name, name),
      ))
      .limit(1);
    return row ? skillToRow(row, []) : null;
  }

  async findByOwnerSlugExcluding(createdBy: string, excludeId: string, slug: string): Promise<SkillRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogSkills)
      .where(and(
        eq(schema.catalogSkills.createdBy, createdBy),
        ne(schema.catalogSkills.id, excludeId),
        eq(schema.catalogSkills.slug, slug),
      ))
      .limit(1);
    return row ? skillToRow(row, []) : null;
  }

  async insert(row: NewSkillRow): Promise<SkillRow> {
    return withTransaction(this.db, async (tx) => {
      const skillId = newObjectId();
      const [inserted] = await tx
        .insert(schema.catalogSkills)
        .values({ id: skillId, ...row })
        .returning();
      const files = row.files ?? [];
      if (files.length > 0) {
        await tx.insert(schema.catalogSkillFiles).values(
          files.map((file, position) => ({
            id: newObjectId(),
            skillId,
            path: file.path,
            kind: file.kind,
            mimeType: file.mimeType,
            content: file.content,
            position,
          })),
        );
      }
      return skillToRow(inserted, files.map((file, position) => ({
        id: '',
        path: file.path,
        kind: file.kind,
        mimeType: file.mimeType,
        content: file.content,
        position,
      })));
    });
  }

  async update(
    id: string,
    patch: Partial<Omit<NewSkillRow, 'createdBy' | 'slug' | 'name'>> & { slug?: string | null; name?: string },
  ): Promise<SkillRow | null> {
    return withTransaction(this.db, async (tx) => {
      const files = patch.files;
      const { files: _files, ...columns } = patch;
      const [row] = await tx
        .update(schema.catalogSkills)
        .set({ ...columns, updatedAt: new Date() })
        .where(eq(schema.catalogSkills.id, id))
        .returning();
      if (!row) return null;
      if (files) {
        // Files are replaced wholesale, mirroring the former array $set.
        await tx.delete(schema.catalogSkillFiles).where(eq(schema.catalogSkillFiles.skillId, id));
        if (files.length > 0) {
          await tx.insert(schema.catalogSkillFiles).values(
            files.map((file, position) => ({
              id: newObjectId(),
              skillId: id,
              path: file.path,
              kind: file.kind,
              mimeType: file.mimeType,
              content: file.content,
              position,
            })),
          );
        }
      }
      const fresh = await tx.select().from(schema.catalogSkills).where(eq(schema.catalogSkills.id, id)).limit(1);
      const allFiles = await tx
        .select()
        .from(schema.catalogSkillFiles)
        .where(eq(schema.catalogSkillFiles.skillId, id))
        .orderBy(asc(schema.catalogSkillFiles.position), asc(schema.catalogSkillFiles.id));
      return fresh[0] ? skillToRow(fresh[0], allFiles.map(fileToRow)) : null;
    });
  }

  async delete(id: string): Promise<SkillRow | null> {
    return withTransaction(this.db, async (tx) => {
      const [row] = await tx.delete(schema.catalogSkills).where(eq(schema.catalogSkills.id, id)).returning();
      return row ? skillToRow(row, []) : null;
    });
  }
}
