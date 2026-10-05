import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hostname as osHostname } from 'os';
import { escapeLike, isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import {
  LogQueryFilters,
  LogQueryOptions,
  LogQueryResult,
} from './interfaces/log-query.interface';
import { escapeRegex } from '../../common/utils';

interface BufferedLog {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
  hostname?: string;
  nodeEnv?: string;
}

/**
 * Unified log entry type for query results (works for both buffer and DB logs)
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
  /** Indicates if this log is from the in-memory buffer (not yet persisted) */
  _fromBuffer?: boolean;
}

const logs = schema.opsLogs;
type LogRow = typeof logs.$inferSelect;

/** Rows per INSERT: 10 parameters each stays far below Postgres' 65,535-parameter limit. */
const INSERT_CHUNK = 500;
/** While the database is not reachable yet the buffer keeps the newest entries only. */
const MAX_HELD_LOGS = 5000;

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

/** JSON the database can hold: BigInt becomes a string, NUL is stripped, and anything unserializable is flagged instead of failing the whole batch. */
function storableData(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (data === undefined) return null;
  try {
    const json = JSON.stringify(data, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
    return stripNul(JSON.parse(json) as Record<string, unknown>);
  } catch {
    return { unserializable: true };
  }
}

@Injectable()
export class LogBufferService implements OnModuleDestroy {
  private buffer: BufferedLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly persistenceEnabled: boolean;
  private readonly hostname: string;
  private readonly nodeEnv: string;
  private isShuttingDown = false;
  private database: NodePgDatabase<typeof schema> | null = null;

  /**
   * The database is resolved lazily: the connection pool itself needs a LoggerService, which needs this
   * service, so injecting it here would be a cycle. Entries logged before it exists wait in the buffer.
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.maxBufferSize = this.configService.get<number>('logging.buffer.maxSize', 100);
    this.flushIntervalMs = this.configService.get<number>('logging.buffer.flushIntervalMs', 60000);
    this.persistenceEnabled = this.configService.get<boolean>('logging.persistenceEnabled', true);
    this.hostname = osHostname();
    this.nodeEnv = this.configService.get<string>('app.nodeEnv', 'development');

    // Start the periodic flush timer only when the SQL writer is active (P07 cutover:
    // reads stay available after persistence is switched off, with no writer/timer).
    if (this.persistenceEnabled) {
      this.startFlushTimer();
    }
  }

  /** Never inside a caller's transaction: a rolled-back request must not erase the logs that explain it. */
  private get db(): NodePgDatabase<typeof schema> | null {
    // Historic reads are intentionally independent of persistenceEnabled (P07): the admin
    // console keeps reading ops.logs through its retention window after the writer is off.
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
   * Add a log entry to the buffer (non-blocking, returns immediately).
   * Operational SQL writes are retired at the unified-logging cutover; the facade no
   * longer calls this, and with persistence off nothing is buffered or written.
   */
  add(log: Omit<BufferedLog, 'hostname' | 'nodeEnv'>): void {
    if (this.isShuttingDown || !this.persistenceEnabled) {
      return;
    }

    const entry: BufferedLog = {
      ...log,
      hostname: this.hostname,
      nodeEnv: this.nodeEnv,
    };

    this.buffer.push(entry);

    // Trigger flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      this.flushAsync();
    }
  }

  /**
   * Flush buffer to PostgreSQL (fire-and-forget)
   */
  private flushAsync(): void {
    // Use setImmediate to not block the calling code
    setImmediate(() => {
      this.flush().catch((err: unknown) => {
        // Silent failure - log to console only
        console.error('[LogBufferService] Failed to flush logs:', err instanceof Error ? err.message : 'Unknown error');
      });
    });
  }

  /**
   * Flush all buffered logs to PostgreSQL
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    if (!this.persistenceEnabled) {
      this.buffer = [];
      return;
    }
    const db = this.db;
    if (!db) {
      // The pool is not up yet: keep the entries, but not without bound.
      if (this.buffer.length > MAX_HELD_LOGS) this.buffer = this.buffer.slice(-MAX_HELD_LOGS);
      return;
    }

    // Swap buffer to avoid race conditions
    const logsToFlush = this.buffer;
    this.buffer = [];

    const rows = logsToFlush.map((log) => {
      const loggedAt = new Date(log.timestamp);
      return {
        id: newObjectId(),
        timestamp: stripNul(log.timestamp),
        level: log.level,
        context: log.context === undefined ? null : stripNul(log.context),
        message: stripNul(log.message),
        data: storableData(log.data),
        traceId: log.traceId ?? null,
        requestId: log.requestId ?? null,
        hostname: log.hostname ?? null,
        nodeEnv: log.nodeEnv ?? null,
        createdAt: Number.isNaN(loggedAt.getTime()) ? new Date() : loggedAt,
      };
    });
    // A failing chunk must not take the others with it (Mongo's insertMany was unordered too).
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      try {
        await db.insert(logs).values(rows.slice(i, i + INSERT_CHUNK));
      } catch (error) {
        // On failure, log to console but don't throw
        // This ensures the app continues even if DB is unavailable
        console.error(
          '[LogBufferService] Failed to persist logs:',
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flushAsync();
      }
    }, this.flushIntervalMs);

    // Prevent the timer from keeping the process alive during shutdown
    this.flushTimer.unref();
  }

  /**
   * Stop the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Graceful shutdown - flush remaining logs before exit
   */
  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    this.stopFlushTimer();

    // Final flush of any remaining logs
    if (this.buffer.length > 0) {
      console.log(`[LogBufferService] Flushing ${this.buffer.length} remaining logs before shutdown...`);
      try {
        await this.flush();
        console.log('[LogBufferService] Final flush completed');
      } catch (error) {
        console.error(
          '[LogBufferService] Final flush failed:',
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    }
  }

  /**
   * Query logs with optional filters and pagination.
   * Searches both the in-memory buffer (unflushed logs) and the database.
   * @param options - Query filters and pagination options
   * @returns Paginated log results
   */
  async findLogs(options: LogQueryOptions = {}): Promise<LogQueryResult<LogEntry>> {
    const { page = 1, limit = 50, sort = 'desc', ...filters } = options;

    // Clamp limit to max 1000
    const clampedLimit = Math.min(Math.max(1, limit), 1000);
    const skip = (Math.max(1, page) - 1) * clampedLimit;

    // Filter buffer logs
    const filteredBufferLogs = this.filterBufferLogs(filters);

    const db = this.db;
    // If no database, return only buffer logs
    if (!db) {
      const sortedBuffer = this.sortLogs(filteredBufferLogs, sort);
      const total = sortedBuffer.length;
      const totalPages = Math.ceil(total / clampedLimit);
      const paginatedData = sortedBuffer.slice(skip, skip + clampedLimit);

      return {
        data: paginatedData,
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

    // Build the filter for the database
    const where = this.buildWhere(filters);

    // Get total count from database
    const [{ count: dbTotal }] = await db.select({ count: sql<number>`count(*)::int` }).from(logs).where(where);
    const bufferCount = filteredBufferLogs.length;
    const total = dbTotal + bufferCount;
    const totalPages = Math.ceil(total / clampedLimit);

    // Determine how many logs to fetch from each source based on pagination
    // Buffer logs are most recent, so they come first when sorting desc (last when asc)
    let data: LogEntry[] = [];

    if (sort === 'desc') {
      // Buffer logs first (most recent), then DB logs
      if (skip < bufferCount) {
        // Need some buffer logs
        const bufferSlice = filteredBufferLogs.slice(skip, Math.min(skip + clampedLimit, bufferCount));
        data = this.sortLogs(bufferSlice, sort);

        // If we need more logs from DB
        const remaining = clampedLimit - data.length;
        if (remaining > 0) {
          data = [...data, ...(await this.readRows(db, where, 'desc', 0, remaining))];
        }
      } else {
        // All logs from DB (skip past buffer)
        data = await this.readRows(db, where, 'desc', skip - bufferCount, clampedLimit);
      }
    } else {
      // sort === 'asc': DB logs first (oldest), then buffer logs
      if (skip < dbTotal) {
        // Need some DB logs
        data = await this.readRows(db, where, 'asc', skip, clampedLimit);

        // If we need more logs from buffer
        const remaining = clampedLimit - data.length;
        if (remaining > 0) {
          const bufferSlice = filteredBufferLogs.slice(0, remaining);
          data = [...data, ...this.sortLogs(bufferSlice, sort)];
        }
      } else {
        // All logs from buffer (skip past DB)
        const bufferSkip = skip - dbTotal;
        const bufferSlice = filteredBufferLogs.slice(bufferSkip, bufferSkip + clampedLimit);
        data = this.sortLogs(bufferSlice, sort);
      }
    }

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
   * Get a single log by ID (only searches database, not buffer)
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
   * Includes values from both buffer and database.
   * @param field - Field name to get distinct values for
   * @param filters - Optional filters to apply before getting distinct values
   * @returns Array of distinct values
   */
  async getDistinctValues(
    field: 'level' | 'context' | 'hostname' | 'nodeEnv',
    filters?: LogQueryFilters,
  ): Promise<string[]> {
    // Get values from buffer
    const filteredBuffer = filters ? this.filterBufferLogs(filters) : this.buffer;
    const bufferValues = new Set<string>();
    for (const log of filteredBuffer) {
      const value = log[field];
      if (value) bufferValues.add(value);
    }

    // Get values from database
    let dbValues: string[] = [];
    const db = this.db;
    if (db) {
      const column = logs[field];
      const where = and(filters ? this.buildWhere(filters) : undefined, isNotNull(column));
      const rows = await db.selectDistinct({ value: column }).from(logs).where(where);
      dbValues = rows.map((row) => row.value).filter((value): value is string => value !== null);
    }

    // Merge and return unique values
    return [...new Set([...bufferValues, ...dbValues])].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get log counts grouped by level
   * Includes counts from both buffer and database.
   * @param filters - Optional filters to apply
   * @returns Object with level as key and count as value
   */
  async getCountsByLevel(filters?: LogQueryFilters): Promise<Record<string, number>> {
    // Count buffer logs by level
    const filteredBuffer = filters ? this.filterBufferLogs(filters) : this.buffer;
    const counts: Record<string, number> = {};

    for (const log of filteredBuffer) {
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    }

    // Count database logs by level
    const db = this.db;
    if (db) {
      const rows = await db
        .select({ level: logs.level, count: sql<number>`count(*)::int` })
        .from(logs)
        .where(filters ? this.buildWhere(filters) : undefined)
        .groupBy(logs.level);

      for (const { level, count } of rows) {
        counts[level] = (counts[level] ?? 0) + count;
      }
    }

    return counts;
  }

  /**
   * Get the current buffer size (number of unflushed logs)
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Filter buffer logs based on query filters
   */
  private filterBufferLogs(filters: LogQueryFilters): LogEntry[] {
    const contextRegex = filters.context && isPattern(filters.context) ? new RegExp(contextPattern(filters.context), 'i') : null;
    const messageRegex = filters.message ? new RegExp(escapeRegex(filters.message), 'i') : null;
    return this.buffer
      .filter((log) => {
        // Level filter
        if (filters.level) {
          const levels: string[] = Array.isArray(filters.level) ? filters.level : [filters.level];
          if (!levels.includes(log.level)) return false;
        }

        // Context filter
        if (filters.context) {
          if (!log.context) return false;
          if (contextRegex) {
            if (!contextRegex.test(log.context)) return false;
          } else if (log.context !== filters.context) {
            return false;
          }
        }

        // Message filter (case-insensitive, literal)
        if (messageRegex && !messageRegex.test(log.message)) return false;

        // Date range filters
        const logDate = new Date(log.timestamp);
        if (filters.from && logDate < new Date(filters.from)) return false;
        if (filters.to && logDate > new Date(filters.to)) return false;

        // Hostname filter
        if (filters.hostname && log.hostname !== filters.hostname) return false;

        // Environment filter
        if (filters.nodeEnv && log.nodeEnv !== filters.nodeEnv) return false;

        // Trace ID filter
        if (filters.traceId && log.traceId !== filters.traceId) return false;

        // Request ID filter
        if (filters.requestId && log.requestId !== filters.requestId) return false;

        return true;
      })
      .map((log) => ({
        ...log,
        _fromBuffer: true,
      }));
  }

  /**
   * Sort log entries by timestamp
   */
  private sortLogs(entries: LogEntry[], sort: 'asc' | 'desc'): LogEntry[] {
    return [...entries].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sort === 'asc' ? timeA - timeB : timeB - timeA;
    });
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
