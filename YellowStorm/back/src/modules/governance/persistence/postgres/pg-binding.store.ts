import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { BINDING_STORE, type BindingStore, type GovernanceBindingCreateInput, type GovernanceBindingPatch } from '../binding-store';
import { DuplicateKeyError, type GovernanceBindingRecord } from '../governance-records';

const BINDINGS = schema.governanceWorkspaceBindings;
const BINDING_SCOPES = schema.governanceBindingScopes;
type BindingRow = typeof BINDINGS.$inferSelect;

export function bindingRowToRecord(row: BindingRow, scopeIds: string[]): GovernanceBindingRecord {
  return {
    id: row.id,
    programId: row.programId,
    workspaceId: row.workspaceId,
    visibility: row.visibility as GovernanceBindingRecord['visibility'],
    scopeIds,
    enabled: row.enabled,
    ingestionMode: row.ingestionMode as GovernanceBindingRecord['ingestionMode'],
    defaults: row.defaults ?? {},
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PG 23505 (unique violation) mapped to the shared DuplicateKeyError seam. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

@Injectable()
export class PgBindingStore implements BindingStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  private async hydrate(rows: BindingRow[]): Promise<GovernanceBindingRecord[]> {
    if (rows.length === 0) return [];
    const scopeRows = await this.q.select().from(BINDING_SCOPES).where(inArray(BINDING_SCOPES.bindingId, rows.map((row) => row.id)));
    const scopesByBinding = new Map<string, string[]>();
    for (const row of scopeRows) scopesByBinding.set(row.bindingId, [...(scopesByBinding.get(row.bindingId) ?? []), row.scopeId]);
    return rows.map((row) => bindingRowToRecord(row, scopesByBinding.get(row.id) ?? []));
  }

  async insert(input: GovernanceBindingCreateInput): Promise<GovernanceBindingRecord> {
    const id = newObjectId();
    try {
      return await withTransaction(this.db, async (tx) => {
        const [row] = await tx
          .insert(BINDINGS)
          .values({
            id,
            programId: input.programId,
            workspaceId: input.workspaceId,
            visibility: input.visibility,
            enabled: true,
            ingestionMode: input.ingestionMode ?? 'assisted',
            defaults: input.defaults ?? {},
            createdBy: input.createdBy,
          })
          .returning();
        if (input.scopeIds.length) await tx.insert(BINDING_SCOPES).values(input.scopeIds.map((scopeId) => ({ bindingId: id, scopeId })));
        return bindingRowToRecord(row, input.scopeIds);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateKeyError('Workspace is already bound to this program');
      throw error;
    }
  }

  async findByProgramAndWorkspace(programId: string, workspaceId: string): Promise<GovernanceBindingRecord | null> {
    const rows = await this.q
      .select()
      .from(BINDINGS)
      .where(and(eq(BINDINGS.programId, programId), eq(BINDINGS.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async findById(bindingId: string): Promise<GovernanceBindingRecord | null> {
    const rows = await this.q.select().from(BINDINGS).where(eq(BINDINGS.id, bindingId)).limit(1);
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async findByIdAndProgram(programId: string, bindingId: string): Promise<GovernanceBindingRecord | null> {
    const rows = await this.q
      .select()
      .from(BINDINGS)
      .where(and(eq(BINDINGS.id, bindingId), eq(BINDINGS.programId, programId)))
      .limit(1);
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async existsByIdAndProgram(programId: string, bindingId: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: BINDINGS.id })
      .from(BINDINGS)
      .where(and(eq(BINDINGS.id, bindingId), eq(BINDINGS.programId, programId)))
      .limit(1);
    return rows.length === 1;
  }

  async listByProgram(programId: string): Promise<GovernanceBindingRecord[]> {
    return this.hydrate(await this.q.select().from(BINDINGS).where(eq(BINDINGS.programId, programId)).orderBy(desc(BINDINGS.createdAt)));
  }

  async listEnabledForWorkspace(workspaceId: string): Promise<GovernanceBindingRecord[]> {
    return this.hydrate(await this.q.select().from(BINDINGS).where(and(eq(BINDINGS.workspaceId, workspaceId), eq(BINDINGS.enabled, true))));
  }

  async listEnabled(programId: string, scopeIds: string[] | '*'): Promise<GovernanceBindingRecord[]> {
    const scopeFilter =
      scopeIds === '*'
        ? undefined
        : scopeIds.length === 0
          ? // Mongo `$in: []` matched nothing: only program-shared bindings remain visible.
            eq(BINDINGS.visibility, 'program_shared')
          : or(
            eq(BINDINGS.visibility, 'program_shared'),
            isNotNull(
              sql`(SELECT 1 FROM ${BINDING_SCOPES} bs WHERE bs.binding_id = ${BINDINGS.id} AND bs.scope_id IN (${sql.join(
                scopeIds.map((id) => sql`${id}`),
                sql`, `,
              )}) LIMIT 1)`,
            ),
          );
    return this.hydrate(
      await this.q
        .select()
        .from(BINDINGS)
        .where(and(eq(BINDINGS.programId, programId), eq(BINDINGS.enabled, true), ...(scopeFilter ? [scopeFilter] : []))),
    );
  }

  async update(bindingId: string, patch: GovernanceBindingPatch): Promise<GovernanceBindingRecord | null> {
    const rows = await this.q
      .update(BINDINGS)
      .set({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.ingestionMode !== undefined ? { ingestionMode: patch.ingestionMode } : {}),
        ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
        updatedAt: new Date(),
      })
      .where(eq(BINDINGS.id, bindingId))
      .returning();
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }


  async replaceScopeIds(bindingId: string, scopeIds: string[], visibility: GovernanceBindingRecord['visibility']): Promise<GovernanceBindingRecord | null> {
    const rows = await withTransaction(this.db, async (tx) => {
      const updated = await tx
        .update(BINDINGS)
        .set({ visibility, updatedAt: new Date() })
        .where(eq(BINDINGS.id, bindingId))
        .returning();
      if (!updated[0]) return [];
      await tx.delete(BINDING_SCOPES).where(eq(BINDING_SCOPES.bindingId, bindingId));
      if (scopeIds.length) await tx.insert(BINDING_SCOPES).values(scopeIds.map((scopeId) => ({ bindingId, scopeId })));
      return updated;
    });
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async deleteById(bindingId: string): Promise<void> {
    await this.q.delete(BINDINGS).where(eq(BINDINGS.id, bindingId));
  }

  async filterWorkspaceIdsBoundToScope(programId: string, workspaceIds: string[], scopeId: string): Promise<string[]> {
    if (workspaceIds.length === 0) return [];
    const rows = await this.q
      .selectDistinct({ workspaceId: BINDINGS.workspaceId })
      .from(BINDINGS)
      .where(
        and(
          eq(BINDINGS.programId, programId),
          eq(BINDINGS.enabled, true),
          inArray(BINDINGS.workspaceId, workspaceIds),
          or(eq(BINDINGS.visibility, 'program_shared'), isNotNull(sql`(SELECT 1 FROM ${BINDING_SCOPES} bs WHERE bs.binding_id = ${BINDINGS.id} AND bs.scope_id = ${scopeId} LIMIT 1)`)),
        ),
      );
    return rows.map((row) => row.workspaceId);
  }

  async countByProgram(programId: string): Promise<number> {
    const rows = await this.q.select({ count: sql<number>`count(*)::int` }).from(BINDINGS).where(eq(BINDINGS.programId, programId));
    return rows[0]?.count ?? 0;
  }

  async removeScopesFromProgramBindings(programId: string, scopeIds: string[]): Promise<void> {
    if (scopeIds.length === 0) return;
    await withTransaction(this.db, async (tx) => {
      // scope_specific bindings on a removed scope, and multi_scope bindings whose scopes
      // are all being removed, are deleted (same outcome as removing the scopes one by one).
      await tx.execute(sql`
        DELETE FROM governance.governance_workspace_bindings b
         WHERE b.program_id = ${programId}
           AND EXISTS (SELECT 1 FROM governance.governance_binding_scopes bs WHERE bs.binding_id = b.id AND bs.scope_id IN ${scopeIds})
           AND (
             b.visibility = 'scope_specific'
             OR (b.visibility = 'multi_scope'
                 AND NOT EXISTS (SELECT 1 FROM governance.governance_binding_scopes bs WHERE bs.binding_id = b.id AND bs.scope_id NOT IN ${scopeIds}))
           )`);
      // Remaining multi_scope bindings simply drop the scopes…
      await tx.execute(sql`
        DELETE FROM governance.governance_binding_scopes bs
         USING governance.governance_workspace_bindings b
         WHERE bs.binding_id = b.id AND b.program_id = ${programId} AND bs.scope_id IN ${scopeIds}`);
      // …and single-scope leftovers are downgraded to scope_specific.
      await tx.execute(sql`
        UPDATE governance.governance_workspace_bindings b
           SET visibility = 'scope_specific', updated_at = now()
         WHERE b.program_id = ${programId} AND b.visibility = 'multi_scope'
           AND (SELECT count(*) FROM governance.governance_binding_scopes bs WHERE bs.binding_id = b.id) = 1`);
    });
  }
}
