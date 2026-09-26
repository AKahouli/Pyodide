import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { type GovernanceProgramCreateInput,  type GovernanceProgramPatch,  type ProgramStore } from '../program-store';
import type { GovernanceProgramRecord } from '../governance-records';

const PROGRAMS = schema.governancePrograms;
type ProgramRow = typeof PROGRAMS.$inferSelect;

export function programRowToRecord(row: ProgramRow): GovernanceProgramRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    domain: row.domain ?? undefined,
    defaultLanguage: row.defaultLanguage,
    status: row.status as GovernanceProgramRecord['status'],
    ownerUserId: row.ownerUserId,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgProgramStore implements ProgramStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernanceProgramCreateInput): Promise<GovernanceProgramRecord> {
    const [row] = await this.q
      .insert(PROGRAMS)
      .values({
        id: newObjectId(),
        name: input.name,
        description: input.description ?? null,
        domain: input.domain ?? null,
        defaultLanguage: input.defaultLanguage,
        status: input.status,
        ownerUserId: input.ownerUserId,
        metadata: input.metadata ?? {},
      })
      .returning();
    return programRowToRecord(row);
  }

  async findById(id: string): Promise<GovernanceProgramRecord | null> {
    const rows = await this.q.select().from(PROGRAMS).where(eq(PROGRAMS.id, id)).limit(1);
    return rows[0] ? programRowToRecord(rows[0]) : null;
  }

  async findByOwnerAndName(ownerUserId: string, name: string): Promise<GovernanceProgramRecord | null> {
    const rows = await this.q
      .select()
      .from(PROGRAMS)
      .where(and(eq(PROGRAMS.ownerUserId, ownerUserId), eq(PROGRAMS.name, name)))
      .limit(1);
    return rows[0] ? programRowToRecord(rows[0]) : null;
  }

  async findByOwnerAndId(ownerUserId: string, programId: string): Promise<GovernanceProgramRecord | null> {
    const rows = await this.q
      .select()
      .from(PROGRAMS)
      .where(and(eq(PROGRAMS.id, programId), eq(PROGRAMS.ownerUserId, ownerUserId)))
      .limit(1);
    return rows[0] ? programRowToRecord(rows[0]) : null;
  }

  async listForOwner(ownerUserId: string, memberProgramIds: string[]): Promise<GovernanceProgramRecord[]> {
    const conditions = memberProgramIds.length
      ? or(eq(PROGRAMS.ownerUserId, ownerUserId), inArray(PROGRAMS.id, memberProgramIds))
      : eq(PROGRAMS.ownerUserId, ownerUserId);
    const rows = await this.q.select().from(PROGRAMS).where(conditions).orderBy(desc(PROGRAMS.updatedAt));
    return rows.map(programRowToRecord);
  }

  async update(id: string, patch: GovernanceProgramPatch): Promise<GovernanceProgramRecord | null> {
    const [row] = await this.q
      .update(PROGRAMS)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
        ...(patch.defaultLanguage !== undefined ? { defaultLanguage: patch.defaultLanguage } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(PROGRAMS.id, id))
      .returning();
    return row ? programRowToRecord(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(PROGRAMS).where(eq(PROGRAMS.id, id));
  }
}
