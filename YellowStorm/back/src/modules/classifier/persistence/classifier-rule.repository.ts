import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { ClassifierRuleScope, type ClassifierRuleRecord } from '../classifier.types';

const t = schema.classifierRules;

type Row = typeof t.$inferSelect;

function toRecord(row: Row): ClassifierRuleRecord {
  return { ...row, scope: row.scope as ClassifierRuleScope };
}

export interface RuleListFilter {
  scope?: ClassifierRuleScope;
  /** `null` restricts to rules without a workspace; `undefined` leaves the workspace unconstrained. */
  workspaceId?: string | null;
}

/** PostgreSQL classifier.rules repository (roadmap P6). */
@Injectable()
export class ClassifierRuleRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** The user's rules, newest first. */
  async listForUser(userId: string, filter: RuleListFilter): Promise<ClassifierRuleRecord[]> {
    if (!isObjectId(userId)) return [];
    const workspace = filter.workspaceId;
    if (workspace !== undefined && workspace !== null && !isObjectId(workspace)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.userId, normalizeObjectId(userId)),
        filter.scope ? eq(t.scope, filter.scope) : undefined,
        workspace === undefined ? undefined : workspace === null ? isNull(t.workspaceId) : eq(t.workspaceId, normalizeObjectId(workspace)),
      ))
      .orderBy(desc(t.createdAt), desc(t.id));
    return rows.map(toRecord);
  }

  /** Enabled rules that apply to a run in `workspaceId`: the user's global ones plus the local ones of that workspace, oldest first. */
  async listActiveForWorkspace(userId: string, workspaceId: string): Promise<ClassifierRuleRecord[]> {
    if (!isObjectId(userId) || !isObjectId(workspaceId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.userId, normalizeObjectId(userId)),
        eq(t.enabled, true),
        or(
          and(eq(t.scope, ClassifierRuleScope.GLOBAL), isNull(t.workspaceId)),
          and(eq(t.scope, ClassifierRuleScope.LOCAL), eq(t.workspaceId, normalizeObjectId(workspaceId))),
        ),
      ))
      .orderBy(asc(t.createdAt), asc(t.id));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<ClassifierRuleRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: { userId: string; scope: ClassifierRuleScope; workspaceId: string | null; text: string; enabled: boolean }): Promise<ClassifierRuleRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        userId: normalizeObjectId(input.userId),
        scope: input.scope,
        workspaceId: input.workspaceId ? normalizeObjectId(input.workspaceId) : null,
        text: input.text,
        enabled: input.enabled,
      })
      .returning();
    return toRecord(row);
  }

  async update(id: string, patch: { text?: string; enabled?: boolean }): Promise<ClassifierRuleRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set({
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async delete(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.delete(t).where(eq(t.id, normalizeObjectId(id)));
  }
}
