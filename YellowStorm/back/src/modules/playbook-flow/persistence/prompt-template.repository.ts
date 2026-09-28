import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const pt = schema.playbookPromptTemplates;

/** One playbook.prompt_templates row. */
export type PromptTemplateRecord = typeof pt.$inferSelect;

/** A whole template as the seed and the import write it. */
export interface PromptTemplateContent {
  key: string;
  title: string;
  category: string;
  description?: string | null;
  systemTemplate: string;
  userTemplate: string;
  enabled: boolean;
  version: number;
  isBuiltIn: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
}

/** An admin edit: absent template texts and flag keep the stored ones. */
export interface PromptTemplateEdit {
  title: string;
  category: string;
  description: string;
  systemTemplate?: string;
  userTemplate?: string;
  enabled?: boolean;
}

const idOrNull = (value: string | null | undefined): string | null => (value && isObjectId(value) ? normalizeObjectId(value) : null);

function toColumns(item: PromptTemplateContent): Omit<typeof pt.$inferInsert, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    key: stripNul(item.key.trim()),
    title: stripNul(item.title.trim()),
    category: stripNul(item.category.trim()),
    description: item.description == null ? null : stripNul(item.description.trim()),
    systemTemplate: stripNul(item.systemTemplate ?? ''),
    userTemplate: stripNul(item.userTemplate ?? ''),
    enabled: item.enabled,
    version: item.version,
    isBuiltIn: item.isBuiltIn,
    createdBy: idOrNull(item.createdBy),
    updatedBy: idOrNull(item.updatedBy),
  };
}

/** PostgreSQL playbook.prompt_templates repository (roadmap P5). `key` is unique. */
@Injectable()
export class PromptTemplateRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Every template (or only the enabled ones), by category then title (byte-wise, like Mongo). */
  async list(options: { enabledOnly?: boolean } = {}): Promise<PromptTemplateRecord[]> {
    return this.q
      .select()
      .from(pt)
      .where(options.enabledOnly ? eq(pt.enabled, true) : undefined)
      .orderBy(sql`${pt.category} COLLATE "C"`, sql`${pt.title} COLLATE "C"`, asc(pt.id));
  }

  async findByKey(key: string): Promise<PromptTemplateRecord | null> {
    const [row] = await this.q.select().from(pt).where(eq(pt.key, key)).limit(1);
    return row ?? null;
  }

  /** Key, version and built-in flag of the templates among `keys` that exist. */
  async findVersions(keys: readonly string[]): Promise<Array<Pick<PromptTemplateRecord, 'key' | 'version' | 'isBuiltIn'>>> {
    if (keys.length === 0) return [];
    return this.q.select({ key: pt.key, version: pt.version, isBuiltIn: pt.isBuiltIn }).from(pt).where(inArray(pt.key, [...keys]));
  }

  async isEmpty(): Promise<boolean> {
    const rows = await this.q.select({ id: pt.id }).from(pt).limit(1);
    return rows.length === 0;
  }

  /** Inserts the templates whose key is not taken yet (a concurrent seeder's rows are left alone); returns how many. */
  async insertMissing(items: readonly PromptTemplateContent[]): Promise<number> {
    if (items.length === 0) return 0;
    const now = new Date();
    const rows = await this.q
      .insert(pt)
      .values(items.map((item) => ({ ...toColumns(item), id: newObjectId(), createdAt: now, updatedAt: now })))
      .onConflictDoNothing({ target: pt.key })
      .returning({ id: pt.id });
    return rows.length;
  }

  /** Overwrites a built-in template with a newer seed version, only while it is built in and older. */
  async upgradeBuiltIn(item: PromptTemplateContent): Promise<boolean> {
    const { createdBy: _createdBy, ...set } = toColumns(item);
    const rows = await this.q
      .update(pt)
      .set({ ...set, updatedBy: null, updatedAt: new Date() })
      .where(and(eq(pt.key, item.key), eq(pt.isBuiltIn, true), lt(pt.version, item.version)))
      .returning({ id: pt.id });
    return rows.length > 0;
  }

  /**
   * Creates or edits the template of `key` in one statement: an edit bumps `version`, keeps the
   * built-in flag and the creator (a template nobody created yet gets `userId`), and keeps the texts
   * and flag the edit leaves out. A new template starts at version 1, not built in.
   */
  async upsertByKey(key: string, edit: PromptTemplateEdit, userId: string): Promise<PromptTemplateRecord> {
    const now = new Date();
    const user = idOrNull(userId);
    const values = {
      id: newObjectId(),
      key: stripNul(key),
      title: stripNul(edit.title.trim()),
      category: stripNul(edit.category.trim()),
      description: stripNul(edit.description),
      systemTemplate: stripNul(edit.systemTemplate ?? ''),
      userTemplate: stripNul(edit.userTemplate ?? ''),
      enabled: edit.enabled ?? true,
      version: 1,
      isBuiltIn: false,
      createdBy: user,
      updatedBy: user,
      createdAt: now,
      updatedAt: now,
    };
    const [row] = await this.q
      .insert(pt)
      .values(values)
      .onConflictDoUpdate({
        target: pt.key,
        set: {
          title: values.title,
          category: values.category,
          description: values.description,
          ...(edit.systemTemplate != null ? { systemTemplate: values.systemTemplate } : {}),
          ...(edit.userTemplate != null ? { userTemplate: values.userTemplate } : {}),
          ...(edit.enabled != null ? { enabled: values.enabled } : {}),
          version: sql`${pt.version} + 1`,
          createdBy: sql`coalesce(${pt.createdBy}, ${user}::char(24))`,
          updatedBy: user,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  async deleteByKey(key: string): Promise<boolean> {
    const rows = await this.q.delete(pt).where(eq(pt.key, key)).returning({ id: pt.id });
    return rows.length > 0;
  }

  /**
   * Replaces the catalogue with `items`, in one transaction: each item overwrites the template of its
   * key (keeping its id and creation time when it exists) and every other template is deleted.
   */
  async replaceAll(items: readonly PromptTemplateContent[]): Promise<void> {
    await withTransaction(this.db, async () => {
      const now = new Date();
      for (const item of items) {
        const set = { ...toColumns(item), updatedAt: now };
        await this.q.insert(pt).values({ ...set, id: newObjectId(), createdAt: now }).onConflictDoUpdate({ target: pt.key, set });
      }
      const keys = items.map((item) => stripNul(item.key.trim()));
      await this.q.delete(pt).where(keys.length > 0 ? notInArray(pt.key, keys) : undefined);
    });
  }
}
