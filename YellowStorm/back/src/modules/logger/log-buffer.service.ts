import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Log, LogDocument } from './schemas/log.schema';
import {
  LogQueryFilters,
  LogQueryOptions,
  LogQueryPagination,
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

@Injectable()
export class LogBufferService implements OnModuleDestroy {
  private buffer: BufferedLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly hostname: string;
  private readonly nodeEnv: string;
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @InjectModel(Log.name, 'logging') private readonly logModel?: Model<LogDocument>,
  ) {
    this.maxBufferSize = this.configService.get<number>('logging.buffer.maxSize', 100);
    this.flushIntervalMs = this.configService.get<number>('logging.buffer.flushIntervalMs', 60000);
    this.hostname = require('os').hostname();
    this.nodeEnv = this.configService.get<string>('app.nodeEnv', 'development');

    // Start the flush timer
    this.startFlushTimer();
  }

  /**
   * Add a log entry to the buffer (non-blocking, returns immediately)
   */
  add(log: Omit<BufferedLog, 'hostname' | 'nodeEnv'>): void {
    if (this.isShuttingDown) {
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
   * Flush buffer to MongoDB (fire-and-forget)
   */
  private flushAsync(): void {
    // Use setImmediate to not block the calling code
    setImmediate(() => {
      this.flush().catch((err) => {
        // Silent failure - log to console only
        console.error('[LogBufferService] Failed to flush logs:', err.message);
      });
    });
  }

  /**
   * Flush all buffered logs to MongoDB
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logModel) {
      return;
    }

    // Swap buffer to avoid race conditions
    const logsToFlush = this.buffer;
    this.buffer = [];

    try {
      // Use insertMany with ordered: false for best performance
      // This allows remaining inserts to continue even if some fail
      await this.logModel.insertMany(logsToFlush, { ordered: false });
    } catch (error) {
      // On failure, log to console but don't throw
      // This ensures the app continues even if DB is unavailable
      console.error(
        '[LogBufferService] Failed to persist logs:',
        error instanceof Error ? error.message : 'Unknown error',
      );
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

    // If no database model, return only buffer logs
    if (!this.logModel) {
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

    // Build the filter query for database
    const query = this.buildFilterQuery(filters);

    // Get total count from database
    const dbTotal = await this.logModel.countDocuments(query);
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
          const dbLogs = await this.logModel
            .find(query)
            .sort({ createdAt: -1 })
            .skip(0)
            .limit(remaining)
            .lean()
            .exec();
          data = [...data, ...this.convertDbLogsToEntries(dbLogs)];
        }
      } else {
        // All logs from DB (skip past buffer)
        const dbSkip = skip - bufferCount;
        const dbLogs = await this.logModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(dbSkip)
          .limit(clampedLimit)
          .lean()
          .exec();
        data = this.convertDbLogsToEntries(dbLogs);
      }
    } else {
      // sort === 'asc': DB logs first (oldest), then buffer logs
      if (skip < dbTotal) {
        // Need some DB logs
        const dbLogs = await this.logModel
          .find(query)
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(clampedLimit)
          .lean()
          .exec();
        data = this.convertDbLogsToEntries(dbLogs);

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
   * @param id - Log document ID
   * @returns Log document or null
   */
  async findLogById(id: string): Promise<LogEntry | null> {
    if (!this.logModel) {
      return null;
    }

    const doc = await this.logModel.findById(id).lean().exec();
    if (!doc) return null;

    return this.convertDbLogsToEntries([doc])[0];
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
    if (this.logModel) {
      const query = filters ? this.buildFilterQuery(filters) : {};
      dbValues = await this.logModel.distinct(field, query).exec();
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
      counts[log.level] = (counts[log.level] || 0) + 1;
    }

    // Count database logs by level
    if (this.logModel) {
      const query = filters ? this.buildFilterQuery(filters) : {};

      const results = await this.logModel.aggregate([
        { $match: query },
        { $group: { _id: '$level', count: { $sum: 1 } } },
      ]);

      for (const { _id, count } of results) {
        counts[_id] = (counts[_id] || 0) + count;
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
    return this.buffer
      .filter((log) => {
        // Level filter
        if (filters.level) {
          const levels = Array.isArray(filters.level) ? filters.level : [filters.level];
          if (!levels.includes(log.level as any)) return false;
        }

        // Context filter
        if (filters.context) {
          if (!log.context) return false;
          if (filters.context.includes('*') || filters.context.startsWith('^')) {
            const pattern = new RegExp(filters.context.replaceAll('*', '.*'), 'i');
            if (!pattern.test(log.context)) return false;
          } else {
            if (log.context !== filters.context) return false;
          }
        }

        // Message filter (case-insensitive)
        if (filters.message) {
          const pattern = new RegExp(filters.message, 'i');
          if (!pattern.test(log.message)) return false;
        }

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
  private sortLogs(logs: LogEntry[], sort: 'asc' | 'desc'): LogEntry[] {
    return [...logs].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sort === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }

  /**
   * Convert database documents to LogEntry format
   */
  private convertDbLogsToEntries(docs: any[]): LogEntry[] {
    return docs.map((doc) => ({
      _id: doc._id?.toString(),
      timestamp: doc.timestamp,
      level: doc.level,
      context: doc.context,
      message: doc.message,
      data: doc.data,
      traceId: doc.traceId,
      requestId: doc.requestId,
      hostname: doc.hostname,
      nodeEnv: doc.nodeEnv,
      createdAt: doc.createdAt,
      _fromBuffer: false,
    }));
  }

  /**
   * Build a MongoDB filter query from LogQueryFilters
   */
  private buildFilterQuery(filters: LogQueryFilters): FilterQuery<Log> {
    const query: FilterQuery<Log> = {};

    // Level filter (single or multiple)
    if (filters.level) {
      if (Array.isArray(filters.level)) {
        query.level = { $in: filters.level };
      } else {
        query.level = filters.level;
      }
    }

    // Context filter (exact match or regex)
    if (filters.context) {
      // If it looks like a regex pattern (contains * or ^), use regex
      if (filters.context.includes('*') || filters.context.startsWith('^')) {
        // Escape special chars except *, then convert * to .*
        const escaped = filters.context.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const pattern = escaped.replaceAll('*', '.*');
        query.context = { $regex: pattern, $options: 'i' };
      } else {
        query.context = filters.context;
      }
    }

    // Message text search (case-insensitive)
    if (filters.message) {
      query.message = { $regex: escapeRegex(filters.message), $options: 'i' };
    }

    // Date range filters
    if (filters.from || filters.to) {
      query.createdAt = {};
      if (filters.from) {
        query.createdAt.$gte = new Date(filters.from);
      }
      if (filters.to) {
        query.createdAt.$lte = new Date(filters.to);
      }
    }

    // Hostname filter
    if (filters.hostname) {
      query.hostname = filters.hostname;
    }

    // Environment filter
    if (filters.nodeEnv) {
      query.nodeEnv = filters.nodeEnv;
    }

    // Trace ID filter
    if (filters.traceId) {
      query.traceId = filters.traceId;
    }

    // Request ID filter
    if (filters.requestId) {
      query.requestId = filters.requestId;
    }

    return query;
  }
}
