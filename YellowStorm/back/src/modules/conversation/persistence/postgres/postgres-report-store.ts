import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newOwnedId } from '../owned-id';
import type { CreateReportRecord, ReportRecord, ReportStore } from '../report-store';

@Injectable()
export class PostgresReportStore implements ReportStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findByUserAndMessage(userId: string, messageId: string): Promise<ReportRecord | null> {
    return this.find(
      and(eq(schema.reports.userId, userId), eq(schema.reports.messageId, messageId)),
    );
  }

  async findSystemCorrectionByMessage(messageId: string): Promise<ReportRecord | null> {
    return this.find(
      and(eq(schema.reports.messageId, messageId), eq(schema.reports.source, 'system_correction')),
    );
  }

  async create(input: CreateReportRecord): Promise<ReportRecord> {
    const [row] = await this.db
      .insert(schema.reports)
      .values({
        id: newOwnedId(),
        ...input,
        status: 'pending',
      })
      .returning();
    return this.map(row);
  }

  async list(params: {
    page: number;
    limit: number;
    sortOrder: 'asc' | 'desc';
    status?: ReportRecord['status'];
    reason?: ReportRecord['reason'];
  }): Promise<{ records: ReportRecord[]; total: number }> {
    const conditions = [
      params.status ? eq(schema.reports.status, params.status) : undefined,
      params.reason ? eq(schema.reports.reason, params.reason) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.reports)
        .where(where)
        .orderBy(
          params.sortOrder === 'asc'
            ? asc(schema.reports.createdAt)
            : desc(schema.reports.createdAt),
        )
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.reports)
        .where(where),
    ]);
    return { records: rows.map((row) => this.map(row)), total: countRows[0]?.count ?? 0 };
  }

  async updateStatus(
    reportId: string,
    status: ReportRecord['status'],
    adminNotes?: string,
  ): Promise<ReportRecord | null> {
    const [row] = await this.db
      .update(schema.reports)
      .set({ status, ...(adminNotes !== undefined ? { adminNotes } : {}), updatedAt: new Date() })
      .where(eq(schema.reports.id, reportId))
      .returning();
    return row ? this.map(row) : null;
  }

  async findById(reportId: string): Promise<ReportRecord | null> {
    return this.find(eq(schema.reports.id, reportId));
  }

  private async find(
    where: ReturnType<typeof eq> | ReturnType<typeof and>,
  ): Promise<ReportRecord | null> {
    const [row] = await this.db.select().from(schema.reports).where(where).limit(1);
    return row ? this.map(row) : null;
  }

  private map(row: typeof schema.reports.$inferSelect): ReportRecord {
    return {
      id: row.id.trim(),
      conversationId: row.conversationId.trim(),
      messageId: row.messageId.trim(),
      userId: row.userId.trim(),
      reason: row.reason as ReportRecord['reason'],
      description: row.description,
      status: row.status as ReportRecord['status'],
      adminNotes: row.adminNotes ?? undefined,
      source: row.source as ReportRecord['source'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
