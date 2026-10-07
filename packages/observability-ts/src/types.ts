export type SeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/** Primitive values permitted at the public API (plan §4.4: no arbitrary object graphs). */
export type AttrPrimitive = string | number | boolean | bigint;
export type AttrValue = AttrPrimitive | AttrPrimitive[];
export type LogAttrs = Record<string, unknown>;

/** Trusted context captured at ingress by the host application (plan §6.1). The SDK never invents it. */
export interface ContextSnapshot {
  trace_id?: string;
  span_id?: string;
  trace_flags?: number;
  request_id?: string;
  user_id?: string;
  username?: string;
  actor_type?: 'user' | 'service' | 'system';
  workspace_id?: string;
  conversation_id?: string;
  run_id?: string;
  job_id?: string;
  agent_id?: string;
}

/** Host-supplied reader (AsyncLocalStorage / contextvars bridge). Must be synchronous and cheap. */
export type ContextReader = () => ContextSnapshot | undefined;

export interface LoggerConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  serviceInstanceId: string;
  minLevel: SeverityText;
  maxEventBytes: number;
  maxQueueEvents: number;
  maxQueueBytes: number;
  errorReserveBytes: number;
  shutdownTimeoutMs: number;
  contextReader?: ContextReader;
  /** For tests: replace the worker module path. */
  workerPath?: string;
  /** For tests: extra environment for the worker process (e.g. OBS_WRITER_FD). */
  workerEnv?: NodeJS.ProcessEnv;
}

export interface LogMetrics {
  attempted_total: number;
  admitted_total: number;
  written_total: number;
  dropped_total: number;
  invalid_total: number;
  pending_events: number;
  pending_bytes: number;
  writer_up: number;
  writer_restarts_total: number;
  shutdown_dropped_total: number;
  dropped_by_reason: Record<string, number>;
  dropped_by_severity: Record<string, number>;
}

export interface ObservabilityLogger {
  debug(eventName: string, attrs?: LogAttrs): void;
  info(eventName: string, attrs?: LogAttrs): void;
  warn(eventName: string, attrs?: LogAttrs): void;
  error(eventName: string, attrs?: LogAttrs): void;
  fatal(eventName: string, attrs?: LogAttrs): void;
  isEnabled(level: SeverityText): boolean;
  child(bindings: Partial<ContextSnapshot>): ObservabilityLogger;
  /** Bounded drain (default: OBS_LOG_SHUTDOWN_TIMEOUT_MS). Resolves when pending work is written or abandoned. */
  shutdown(timeoutMs?: number): Promise<void>;
  metricsSnapshot(): LogMetrics;
}
