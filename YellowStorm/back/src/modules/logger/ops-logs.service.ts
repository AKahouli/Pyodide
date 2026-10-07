import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { escapeLike, isObjectId, normalizeObjectId } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import {
  LogQueryFilters,
  LogQueryOptions,
  LogQueryResult,
} from './interfaces/log-query.interface';
import { escapeRegex } from '../../common/utils';

/**
 * Unified log entry type for query results over historic ops.logs.
 * `_fromBuffer` is kept for API-contract stability; the write path was retired in P11
 * and every entry now comes from the database.
 */
export interface LogEntry {
  _id?: string;
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
  hostname?: string;
  nodeEnv?: string;
  createdAt?: Date;
  _fromBuffer?: boolean;
}

const logs = schema.opsLogs;
type LogRow = typeof logs.$inferSelect;

/**
 * A `context` filter is exact unless it holds a `*` or starts with `^`: `*` then matches anything, a
 * leading `^` anchors the start, and every other character is literal. Case-insensitive, unanchored otherwise.
 */
function contextPattern(context: string): string {
  const anchored = context.startsWith('^');
  const body = escapeRegex(anchored ? context.slice(1) : context).replaceAll('\\*', '.*');
  return `${anchored ? '^' : ''}${body}`;
}
const isPattern = (context: string): boolean => context.includes('*') || context.startsWith('^');

/**
 * Read-only query service over the historic ops.logs table (P11: the SQL write path was
 * retired at the unified-logging cutover; live events go to Grafana through the SDK).
 * The admin console keeps reading through the retention window.
 */
@Injectable()
export class OpsLogsService {
  private database: NodePgDatabase<typeof schema> | null = null;

  /**
   * The database is resolved lazily: the connection pool itself needs a LoggerService, which needs this
   * service, so injecting it here would be a cycle.
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get db(): NodePgDatabase<typeof schema> | null {
    if (!this.database) {
      try {
        this.database = this.moduleRef.get<NodePgDatabase<typeof schema>>(DRIZZLE_DB, { strict: false });
      } catch {
        return null;
      }
    }
    return this.database;
  }

  /**
   * Query logs with optional filters and pagination.
   * @param options - Query filters and pagination options
   * @returns Paginated log results
   */
  async findLogs(options: LogQueryOptions = {}): Promise<LogQueryResult<LogEntry>> {
    const { page = 1, limit = 50, sort = 'desc', ...filters } = options;

    // Clamp limit to max 1000
    const clampedLimit = Math.min(Math.max(1, limit), 1000);
    const skip = (Math.max(1, page) - 1) * clampedLimit;
    const db = this.db;

    if (!db) {
      return {
        data: [],
        pagination: { page, limit: clampedLimit, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      };
    }

    const where = this.buildWhere(filters);
    const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(logs).where(where);
    const totalPages = Math.ceil(total / clampedLimit);
    const data = await this.readRows(db, where, sort, skip, clampedLimit);

    return {
      data,
      pagination: {
        page,
        limit: clampedLimit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get a single log by ID
   * @param id - Log ID
   * @returns Log entry or null
   */
  async findLogById(id: string): Promise<LogEntry | null> {
    const db = this.db;
    if (!db || !isObjectId(id)) {
      return null;
    }

    const [row] = await db.select().from(logs).where(eq(logs.id, normalizeObjectId(id))).limit(1);
    return row ? this.toEntry(row) : null;
  }

  /**
   * Get distinct values for a field (useful for filter dropdowns)
   * @param field - Field name to get distinct values for
   * @param filters - Optional filters to apply before getting distinct values
   * @returns Array of distinct values
   */
  async getDistinctValues(
    field: 'level' | 'context' | 'hostname' | 'nodeEnv',
    filters?: LogQueryFilters,
  ): Promise<string[]> {
    const db = this.db;
    if (!db) return [];

    const column = logs[field];
    const where = and(filters ? this.buildWhere(filters) : undefined, isNotNull(column));
    const rows = await db.selectDistinct({ value: column }).from(logs).where(where);
    return rows.map((row) => row.value).filter((value): value is string => value !== null).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get log counts grouped by level
   * @param filters - Optional filters to apply
   * @returns Object with level as key and count as value
   */
  async getCountsByLevel(filters?: LogQueryFilters): Promise<Record<string, number>> {
    const db = this.db;
    if (!db) return {};

    const rows = await db
      .select({ level: logs.level, count: sql<number>`count(*)::int` })
      .from(logs)
      .where(filters ? this.buildWhere(filters) : undefined)
      .groupBy(logs.level);

    const counts: Record<string, number> = {};
    for (const { level, count } of rows) {
      counts[level] = count;
    }
    return counts;
  }

  private async readRows(db: NodePgDatabase<typeof schema>, where: SQL | undefined, sort: 'asc' | 'desc', offset: number, limit: number): Promise<LogEntry[]> {
    const order = sort === 'asc' ? [asc(logs.createdAt), asc(logs.id)] : [desc(logs.createdAt), desc(logs.id)];
    const rows = await db.select().from(logs).where(where).orderBy(...order).limit(limit).offset(offset);
    return rows.map((row) => this.toEntry(row));
  }

  /** A stored row as the API always returned it: absent fields are omitted, not null. */
  private toEntry(row: LogRow): LogEntry {
    return {
      _id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      ...(row.context !== null ? { context: row.context } : {}),
      message: row.message,
      ...(row.data !== null ? { data: row.data } : {}),
      ...(row.traceId !== null ? { traceId: row.traceId } : {}),
      ...(row.requestId !== null ? { requestId: row.requestId } : {}),
      ...(row.hostname !== null ? { hostname: row.hostname } : {}),
      ...(row.nodeEnv !== null ? { nodeEnv: row.nodeEnv } : {}),
      createdAt: row.createdAt,
      _fromBuffer: false,
    };
  }

  /**
   * Build the SQL filter from LogQueryFilters
   */
  private buildWhere(filters: LogQueryFilters): SQL | undefined {
    const validDate = (value: Date | string | undefined): Date | null => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const from = validDate(filters.from);
    const to = validDate(filters.to);

    // Level filter (single or multiple)
    const levels = filters.level ? (Array.isArray(filters.level) ? filters.level : [filters.level]) : null;

    return and(
      levels ? (levels.length > 0 ? inArray(logs.level, levels) : sql`false`) : undefined,
      // Context filter (exact match or pattern)
      filters.context ? (isPattern(filters.context) ? sql`${logs.context} ~* ${contextPattern(filters.context)}` : eq(logs.context, filters.context)) : undefined,
      // Message text search (case-insensitive, literal)
      filters.message ? ilike(logs.message, `%${escapeLike(filters.message)}%`) : undefined,
      from ? gte(logs.createdAt, from) : undefined,
      to ? lte(logs.createdAt, to) : undefined,
      filters.hostname ? eq(logs.hostname, filters.hostname) : undefined,
      filters.nodeEnv ? eq(logs.nodeEnv, filters.nodeEnv) : undefined,
      filters.traceId ? eq(logs.traceId, filters.traceId) : undefined,
      filters.requestId ? eq(logs.requestId, filters.requestId) : undefined,
    );
  }
}
