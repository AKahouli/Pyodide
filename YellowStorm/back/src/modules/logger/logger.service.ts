import { Injectable, LoggerService as NestLoggerService, Optional, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  boundedDetail,
  createLogger,
  type ContextReader,
  type LogAttrs,
  type ObservabilityLogger,
  type SeverityText,
} from '@yellowmind/observability';
import { LogOptions } from './interfaces/log-options.interface';
import { RequestContextService } from '../request-context';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4,
}

/**
 * Migration facade (plan §9.1): the public LoggerService API is preserved while the operational
 * write path goes through @yellowmind/observability as `legacy.log` events (stderr JSON lines).
 * PostgreSQL persistence is no longer fed; LogBufferService remains only for historic reads
 * (see admin-logs controller) until the P07 read-side cutover.
 */
const LEGACY_SEVERITY: Record<string, SeverityText> = {
  INFO: 'INFO',
  WARN: 'WARN',
  DEBUG: 'DEBUG',
  VERBOSE: 'TRACE',
  ERROR: 'ERROR',
};

const SEVERITY_METHOD: Record<SeverityText, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = {
  TRACE: 'debug',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
};

// One SDK writer per process (plan §5.2): transient LoggerService instances share it.
let sharedSdk: ObservabilityLogger | null = null;
let sharedContextReader: ContextReader | undefined;

function getSdk(): ObservabilityLogger {
  if (!sharedSdk) {
    sharedSdk = createLogger({ contextReader: () => sharedContextReader?.() });
  }
  return sharedSdk;
}

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  private context?: string;
  private readonly logLevel: LogLevel;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly requestContextService?: RequestContextService,
  ) {
    this.logLevel = this.getLogLevelFromEnv();
    if (requestContextService && !sharedContextReader) {
      sharedContextReader = () => {
        const ctx = requestContextService.getContext();
        return ctx ? { request_id: ctx.requestId, user_id: ctx.userId } : undefined;
      };
    }
  }

  setContext(context: string): void {
    this.context = context;
  }

  metricsSnapshot() {
    return getSdk().metricsSnapshot();
  }

  /** Flush pending SDK events within the configured shutdown budget. */
  async onApplicationShutdown(): Promise<void> {
    await getSdk().shutdown();
  }

  // log() overloads - backward compatible + new options
  log(message: string): void;
  log(message: string, context: string): void;
  log(message: string, options: LogOptions): void;
  log(message: string, data: Record<string, unknown>): void;
  log(message: string, data: Record<string, unknown>, context: string): void;
  log(message: string, data: Record<string, unknown>, options: LogOptions): void;
  log(
    message: string,
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    if (this.logLevel < LogLevel.INFO) return;
    this.writeLog('INFO', message, dataOrContextOrOptions, contextOrOptions);
  }

  // error() overloads - backward compatible + new options
  error(message: string): void;
  error(message: string, trace: string): void;
  error(message: string, trace: string, context: string): void;
  error(message: string, options: LogOptions): void;
  error(message: string, data: Record<string, unknown>): void;
  error(message: string, data: Record<string, unknown>, context: string): void;
  error(message: string, data: Record<string, unknown>, options: LogOptions): void;
  error(
    message: string,
    traceOrDataOrOptions?: string | Record<string, unknown> | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    if (this.logLevel < LogLevel.ERROR) return;

    // Handle trace string specially (legacy error(message, trace) keeps its stack)
    if (typeof traceOrDataOrOptions === 'string' && !this.isLogOptions(traceOrDataOrOptions)) {
      this.writeLog('ERROR', message, { trace: traceOrDataOrOptions }, contextOrOptions);
    } else {
      this.writeLog('ERROR', message, traceOrDataOrOptions, contextOrOptions);
    }
  }

  // warn() overloads - backward compatible + new options
  warn(message: string): void;
  warn(message: string, context: string): void;
  warn(message: string, options: LogOptions): void;
  warn(message: string, data: Record<string, unknown>): void;
  warn(message: string, data: Record<string, unknown>, context: string): void;
  warn(message: string, data: Record<string, unknown>, options: LogOptions): void;
  warn(
    message: string,
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    if (this.logLevel < LogLevel.WARN) return;
    this.writeLog('WARN', message, dataOrContextOrOptions, contextOrOptions);
  }

  // debug() overloads - backward compatible + new options
  debug(message: string): void;
  debug(message: string, context: string): void;
  debug(message: string, options: LogOptions): void;
  debug(message: string, data: Record<string, unknown>): void;
  debug(message: string, data: Record<string, unknown>, context: string): void;
  debug(message: string, data: Record<string, unknown>, options: LogOptions): void;
  debug(
    message: string,
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    if (this.logLevel < LogLevel.DEBUG) return;
    this.writeLog('DEBUG', message, dataOrContextOrOptions, contextOrOptions);
  }

  // verbose() overloads - backward compatible + new options
  verbose(message: string): void;
  verbose(message: string, context: string): void;
  verbose(message: string, options: LogOptions): void;
  verbose(message: string, data: Record<string, unknown>): void;
  verbose(message: string, data: Record<string, unknown>, context: string): void;
  verbose(message: string, data: Record<string, unknown>, options: LogOptions): void;
  verbose(
    message: string,
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    if (this.logLevel < LogLevel.VERBOSE) return;
    this.writeLog('VERBOSE', message, dataOrContextOrOptions, contextOrOptions);
  }

  private writeLog(
    level: string,
    message: string,
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): void {
    const { data, context, options } = this.parseArguments(dataOrContextOrOptions, contextOrOptions);
    const severity = LEGACY_SEVERITY[level] ?? 'INFO';

    const attrs: LogAttrs = {
      logger_name: context,
      level: level.toLowerCase(),
      detail: message,
    };
    let error: unknown;
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (key === 'trace' && typeof value === 'string') {
          error = { type: 'Error', stack: value }; // legacy error(message, traceString)
          continue;
        }
        if (value !== null && value !== undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
          attrs[key] = value;
        }
      }
      const detailData = boundedDetail(data);
      if (detailData !== undefined) attrs.detail_data = detailData;
    }
    if (error !== undefined) attrs.error = error;

    // `save`/`display` LogOptions are retired (plan §9.1); they no longer select sinks.
    const target = options.requestId ? getSdk().child({ request_id: options.requestId }) : getSdk();
    target[SEVERITY_METHOD[severity]]('legacy.log', attrs);
  }

  /**
   * Parse the various argument combinations to extract data, context, and options
   */
  private parseArguments(
    dataOrContextOrOptions?: Record<string, unknown> | string | LogOptions,
    contextOrOptions?: string | LogOptions,
  ): { data?: Record<string, unknown>; context?: string; options: LogOptions } {
    let data: Record<string, unknown> | undefined;
    let context: string | undefined = this.context;
    let options: LogOptions = {};

    // First argument analysis
    if (dataOrContextOrOptions === undefined) {
      // No additional args
    } else if (typeof dataOrContextOrOptions === 'string') {
      // It's a context string
      context = dataOrContextOrOptions;
    } else if (this.isLogOptions(dataOrContextOrOptions)) {
      // It's LogOptions
      options = dataOrContextOrOptions;
    } else {
      // It's data object
      data = dataOrContextOrOptions;
    }

    // Second argument analysis
    if (contextOrOptions !== undefined) {
      if (typeof contextOrOptions === 'string') {
        context = contextOrOptions;
      } else if (this.isLogOptions(contextOrOptions)) {
        options = contextOrOptions;
      }
    }

    return { data, context, options };
  }

  /**
   * Check if an object is a LogOptions object
   * LogOptions has 'display', 'save' (boolean), and/or 'requestId' (string) keys
   */
  private isLogOptions(obj: unknown): obj is LogOptions {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);

    // Empty object is not LogOptions (treat as empty data)
    if (keys.length === 0) return false;

    // Must only have valid LogOptions keys
    const validKeys = ['display', 'save', 'requestId'];
    const hasOnlyValidKeys = keys.every((k) => validKeys.includes(k));
    if (!hasOnlyValidKeys) return false;

    // Validate value types
    const typedObj = obj as Record<string, unknown>;
    for (const key of keys) {
      const value = typedObj[key];
      if (value === undefined) continue;

      if (key === 'requestId') {
        if (typeof value !== 'string') return false;
      } else {
        // display and save must be boolean
        if (typeof value !== 'boolean') return false;
      }
    }

    return true;
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = this.configService.get<string>('app.logLevel', 'info').toLowerCase();
    const levels: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
      verbose: LogLevel.VERBOSE,
    };
    return levels[level] ?? LogLevel.INFO;
  }
}
