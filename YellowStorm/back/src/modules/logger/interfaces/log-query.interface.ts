import { LogLevelEnum } from '../schemas/log.schema';

/**
 * Filters for querying logs
 */
export interface LogQueryFilters {
  /**
   * Filter by log level(s)
   */
  level?: LogLevelEnum | LogLevelEnum[];

  /**
   * Filter by context (exact match or regex pattern)
   */
  context?: string;

  /**
   * Search in message text (case-insensitive)
   */
  message?: string;

  /**
   * Filter logs from this date/time
   */
  from?: Date | string;

  /**
   * Filter logs until this date/time
   */
  to?: Date | string;

  /**
   * Filter by hostname
   */
  hostname?: string;

  /**
   * Filter by environment (development, production, test)
   */
  nodeEnv?: string;

  /**
   * Filter by trace ID
   */
  traceId?: string;

  /**
   * Filter by request ID
   */
  requestId?: string;
}

/**
 * Pagination options for log queries
 */
export interface LogQueryPagination {
  /**
   * Page number (1-based)
   * @default 1
   */
  page?: number;

  /**
   * Number of items per page
   * @default 50
   * @max 1000
   */
  limit?: number;

  /**
   * Sort order for timestamp
   * @default 'desc'
   */
  sort?: 'asc' | 'desc';
}

/**
 * Combined query options
 */
export interface LogQueryOptions extends LogQueryFilters, LogQueryPagination {}

/**
 * Result of a paginated log query
 */
export interface LogQueryResult<T> {
  /**
   * Array of log entries
   */
  data: T[];

  /**
   * Pagination metadata
   */
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
