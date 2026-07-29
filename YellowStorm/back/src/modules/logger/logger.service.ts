import { Injectable, LoggerService as NestLoggerService, Optional, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogBufferService } from './log-buffer.service';
import { LogOptions } from './interfaces/log-options.interface';
import { RequestContextService } from '../request-context';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4,
}

interface LogEntry {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  private context?: string;
  private readonly isProduction: boolean;
  private readonly logLevel: LogLevel;
  private readonly persistenceEnabled: boolean;
  private readonly defaultSave: boolean;
  private readonly defaultDisplay: boolean;
  private readonly displayOnlyContexts: Set<string>;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly logBuffer?: LogBufferService,
    @Optional() private readonly requestContextService?: RequestContextService,
  ) {
    this.isProduction = this.configService.get<string>('app.nodeEnv') === 'production';
    this.logLevel = this.getLogLevelFromEnv();
    this.persistenceEnabled = this.configService.get<boolean>('logging.persistenceEnabled', true);
    this.defaultSave = this.configService.get<boolean>('logging.defaultSave', true);
    this.defaultDisplay = this.configService.get<boolean>('logging.defaultDisplay', true);
    this.displayOnlyContexts = new Set(
      this.configService.get<string[]>('logging.displayOnlyContexts', []),
    );
  }

  setContext(context: string): void {
    this.context = context;
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

    // Handle trace string specially (convert to data object)
    if (typeof traceOrDataOrOptions === 'string' && !this.isLogOptions(traceOrDataOrOptions)) {
      const data = { trace: traceOrDataOrOptions };
      this.writeLog('ERROR', message, data, contextOrOptions);
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
    // Parse arguments to extract data, context, and options
    const { data, context, options } = this.parseArguments(dataOrContextOrOptions, contextOrOptions);

    // Check if this context is display-only (e.g., startup/bootstrap logs)
    const isDisplayOnlyContext = context ? this.displayOnlyContexts.has(context) : false;

    // Determine display and save based on options, defaults, and context
    const shouldDisplay = options.display ?? this.defaultDisplay;
    const shouldSave = isDisplayOnlyContext ? false : (options.save ?? this.defaultSave);
    const requestId = options.requestId ?? this.requestContextService?.getRequestId();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      ...(data && { data: this.sanitize(data) }),
      ...(requestId && { requestId }),
    };

    // Write to console if display is enabled
    if (shouldDisplay) {
      if (this.isProduction) {
        this.writeJson(entry);
      } else {
        this.writePretty(entry);
      }
    }

    // Save to database if save is enabled and persistence is available
    if (shouldSave && this.persistenceEnabled && this.logBuffer) {
      this.logBuffer.add({
        timestamp: entry.timestamp,
        level: entry.level,
        context: entry.context,
        message: entry.message,
        data: entry.data,
        requestId: entry.requestId,
      });
    }
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

  private writeJson(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    if (entry.level === 'ERROR') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  private writePretty(entry: LogEntry): void {
    const color = this.getColor(entry.level);
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    const contextStr = entry.context ? `[${entry.context}]` : '';
    const requestIdStr = entry.requestId ? `{${entry.requestId}} ` : '';
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';

    const output = `${dim}${entry.timestamp}${reset} ${color}${entry.level.padEnd(7)}${reset} ${requestIdStr}${contextStr} ${entry.message}${dataStr}\n`;

    if (entry.level === 'ERROR') {
      process.stderr.write(output);
    } else {
      process.stdout.write(output);
    }
  }

  private getColor(level: string): string {
    const colors: Record<string, string> = {
      ERROR: '\x1b[31m',
      WARN: '\x1b[33m',
      INFO: '\x1b[32m',
      DEBUG: '\x1b[36m',
      VERBOSE: '\x1b[35m',
    };
    return colors[level] || '\x1b[0m';
  }

  private sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      try {
        const u = new URL(value);
        return `${u.protocol}//${u.host}${u.pathname}[QUERY_REDACTED]`;
      } catch {
        return value;
      }
    }
    return value;
  }

  private sanitize(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
    const MAX_DEPTH = 10;
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'authorization',
      'apikey',
      'api_key',
      'accessToken',
      'refreshToken',
      'credentials',
      'sessionId',
      'cookie',
      'set-cookie',
      'downloadUrl',
      'authHeaders',
      'signature',
      'code',
      'state',
    ];

    if (depth >= MAX_DEPTH) {
      return { _truncated: '[MAX_DEPTH_EXCEEDED]' };
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else if (Array.isArray(value)) {
        sanitized[key] = value.slice(0, 100).map((item) =>
          typeof item === 'object' && item !== null
            ? this.sanitize(item as Record<string, unknown>, depth + 1)
            : this.sanitizeValue(item),
        );
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>, depth + 1);
      } else {
        sanitized[key] = this.sanitizeValue(value);
      }
    }

    return sanitized;
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
