import { BUDGETS, EVENT_REGISTRY, SEVERITY_NUMBER, isSensitiveKey, REDACTION } from './contract';
import { boundStack, sanitizeStack, scrubText, truncateUtf8 } from './redact';
import type { ContextSnapshot, LogAttrs, SeverityText } from './types';

const REDACTED = REDACTION.redacted_marker;
const ATTR_KEY = /^[a-z][a-z0-9_]*$/;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;

export interface EnvelopeInput {
  eventName: string;
  severity: SeverityText;
  attrs?: LogAttrs;
  context?: ContextSnapshot;
  origin?: 'application' | 'framework' | 'infrastructure' | 'logger';
  identity: {
    serviceName: string;
    serviceVersion: string;
    environment: string;
    serviceInstanceId: string;
    bootId: string;
    sequence: number;
  };
}

export interface BuiltEvent {
  line: string;
  bytes: number;
}

export interface InvalidEvent {
  invalid: string;
}

interface ErrorSummary {
  type?: string;
  code?: string;
  message?: string;
  stack?: string;
  retryable?: boolean;
  cause?: ErrorSummary;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function addTruncated(set: Set<string>, field: string): void {
  if (set.size < 16) set.add(truncateUtf8(field, 64));
}

function summaryFromError(err: unknown, depth: number, prefix: string, truncated: Set<string>): ErrorSummary {
  const out: ErrorSummary = {};
  if (err instanceof Error) {
    if (err.name) out.type = truncateUtf8(err.name, 128);
    const code = (err as NodeJS.ErrnoException).code;
    if (typeof code === 'string') out.code = truncateUtf8(code, 128);
    const scrubbedMessage = scrubText(String(err.message ?? ''));
    out.message = truncateUtf8(scrubbedMessage, BUDGETS.max_error_message_bytes);
    if (out.message !== scrubbedMessage) addTruncated(truncated, `${prefix}.message`);
    if (err.stack) {
      const raw = sanitizeStack(err.stack);
      out.stack = boundStack(err.stack);
      if (out.stack !== raw) addTruncated(truncated, `${prefix}.stack`);
    }
    const retryable = (err as { retryable?: unknown }).retryable;
    if (typeof retryable === 'boolean') out.retryable = retryable;
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== null && depth < BUDGETS.max_error_cause_depth) {
      out.cause = summaryFromError(cause, depth + 1, `${prefix}.cause`, truncated);
    }
    return out;
  }
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.type === 'string') out.type = truncateUtf8(rec.type, 128);
    if (typeof rec.code === 'string') out.code = truncateUtf8(rec.code, 128);
    if (typeof rec.message === 'string') {
      const scrubbed = scrubText(rec.message);
      out.message = truncateUtf8(scrubbed, BUDGETS.max_error_message_bytes);
      if (out.message !== scrubbed) addTruncated(truncated, `${prefix}.message`);
    }
    if (typeof rec.stack === 'string') {
      const raw = sanitizeStack(rec.stack);
      out.stack = boundStack(rec.stack);
      if (out.stack !== raw) addTruncated(truncated, `${prefix}.stack`);
    }
    if (typeof rec.retryable === 'boolean') out.retryable = rec.retryable;
    if (rec.cause !== undefined && rec.cause !== null && depth < BUDGETS.max_error_cause_depth) {
      out.cause = summaryFromError(rec.cause, depth + 1, `${prefix}.cause`, truncated);
    }
  }
  return out;
}

/** Deterministic truncation order (budgets.v1.json): stack tail -> error -> attributes; registry identity is always preserved. */
function degrade(event: Record<string, unknown>, truncated: Set<string>, maxBytes: number): string | null {
  const attempts: Array<[string, () => void]> = [
    ['error.stack', () => {
      if (event.error && typeof event.error === 'object') delete (event.error as ErrorSummary).stack;
    }],
    ['error', () => { delete event.error; }],
    ['attributes', () => { delete event.attributes; }],
  ];
  for (const [field, drop] of attempts) {
    if (field === 'error.stack' && !event.error) continue;
    drop();
    addTruncated(truncated, field);
    event.truncated_fields = [...truncated];
    const line = JSON.stringify(event);
    if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line;
  }
  return null;
}

function cleanAttr(value: unknown, key: string, truncated: Set<string>): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'bigint') return truncateUtf8(value.toString(), BUDGETS.max_attribute_string_bytes);
  if (typeof value === 'string') {
    const out = truncateUtf8(scrubText(value), BUDGETS.max_attribute_string_bytes);
    if (out !== value) addTruncated(truncated, `attrs.${key}`);
    return out;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    let dropped = value.length > BUDGETS.max_array_items;
    for (const item of value.slice(0, BUDGETS.max_array_items)) {
      if (typeof item === 'boolean' || isFiniteNumber(item)) items.push(item);
      else if (typeof item === 'string') {
        const out = truncateUtf8(scrubText(item), BUDGETS.max_attribute_string_bytes);
        if (out !== item) dropped = true;
        items.push(out);
      } else if (typeof item === 'bigint') items.push(truncateUtf8(item.toString(), BUDGETS.max_attribute_string_bytes));
      else dropped = true; // non-primitive array items are discarded
    }
    if (dropped) addTruncated(truncated, `attrs.${key}`);
    return items;
  }
  addTruncated(truncated, `attrs.${key}`); // objects/functions/symbols: discarded (no graphs, no toJSON)
  return undefined;
}

/**
 * Build one bounded, frozen (string) event. All caller values are copied or dropped here —
 * nothing retained by reference, and no I/O happens on this path.
 */
export function buildEnvelope(input: EnvelopeInput, maxEventBytes = BUDGETS.max_event_bytes): BuiltEvent | InvalidEvent {
  const reg = EVENT_REGISTRY[input.eventName];
  const truncated = new Set<string>();
  if (!reg) return { invalid: 'unknown_event' };

  const { identity } = input;
  const ctx = input.context ?? {};
  const event: Record<string, unknown> = {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    event_id: `${identity.bootId}:${identity.sequence}`,
    event_name: input.eventName,
    message: reg.message,
    severity_text: input.severity,
    severity_number: SEVERITY_NUMBER[input.severity],
    service_name: identity.serviceName,
    service_version: identity.serviceVersion,
    environment: identity.environment,
    event_origin: input.origin ?? 'application',
    service_instance_id: identity.serviceInstanceId,
  };

  // Contextual fields: only valid values are emitted; nothing is fabricated.
  if (typeof ctx.trace_id === 'string' && TRACE_ID.test(ctx.trace_id)) event.trace_id = ctx.trace_id;
  if (typeof ctx.span_id === 'string' && SPAN_ID.test(ctx.span_id)) event.span_id = ctx.span_id;
  if (event.trace_id !== undefined && typeof ctx.trace_flags === 'number' && Number.isInteger(ctx.trace_flags) && ctx.trace_flags >= 0 && ctx.trace_flags <= 255) {
    event.trace_flags = ctx.trace_flags; // flags without a trace are meaningless
  }
  for (const field of ['request_id', 'user_id', 'username', 'actor_type', 'workspace_id', 'conversation_id', 'run_id', 'job_id', 'agent_id'] as const) {
    const value = ctx[field];
    if (typeof value === 'string' && value.length > 0 && value.length <= 128) event[field] = value;
  }

  // Attributes: primitives and small primitive arrays only; sensitive keys redacted; hostile values dropped.
  const attributes: Record<string, unknown> = {};
  let attrCount = 0;
  const attrs = input.attrs;
  if (attrs) {
    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(attrs);
    } catch {
      entries = []; // hostile object (throwing getter during enumeration) — emit without attributes
      addTruncated(truncated, 'attrs');
    }
    for (const [key, value] of entries) {
      if (key === 'error' && value !== undefined && value !== null) {
        continue; // handled after the loop so attribute caps cannot displace it
      }
      if (isSensitiveKey(key)) {
        if (attrCount < BUDGETS.max_attributes) {
          attributes[key] = REDACTED;
          attrCount++;
        }
        continue;
      }
      if (attrCount >= BUDGETS.max_attributes) {
        addTruncated(truncated, `attrs.${key}`);
        continue;
      }
      if (!ATTR_KEY.test(key)) {
        addTruncated(truncated, `attrs.${truncateUtf8(key, 32)}`);
        continue;
      }
      const clean = cleanAttr(value, key, truncated);
      if (clean === undefined) continue;
      attributes[key] = clean;
      attrCount++;
    }
  }

  if (attrs && attrs.error !== undefined && attrs.error !== null) {
    try {
      const summary = summaryFromError(attrs.error, 0, 'error', truncated);
      if (Object.keys(summary).length > 0) event.error = summary;
    } catch {
      addTruncated(truncated, 'error'); // hostile error object
    }
  }
  event.attributes = attributes; // required by the contract, possibly empty
  if (truncated.size > 0) event.truncated_fields = [...truncated];

  const line = JSON.stringify(event);
  if (Buffer.byteLength(line, 'utf8') <= maxEventBytes) return { line, bytes: Buffer.byteLength(line, 'utf8') };
  const degraded = degrade(event, truncated, maxEventBytes);
  if (degraded !== null) return { line: degraded, bytes: Buffer.byteLength(degraded, 'utf8') };
  return { invalid: 'event_oversized' };
}

/** Internal event used when a developer call is itself invalid. Bypasses registry checks; must never recurse. */
export function buildInvalidEvent(
  identity: EnvelopeInput['identity'],
  severity: SeverityText,
  reasonCode: string,
  scope: string,
): BuiltEvent {
  const event: Record<string, unknown> = {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    event_id: `${identity.bootId}:${identity.sequence}`,
    event_name: 'logger.event.invalid',
    message: EVENT_REGISTRY['logger.event.invalid'].message,
    severity_text: severity,
    severity_number: SEVERITY_NUMBER[severity],
    service_name: identity.serviceName,
    service_version: identity.serviceVersion,
    environment: identity.environment,
    event_origin: 'logger',
    service_instance_id: identity.serviceInstanceId,
    attributes: {
      reason_code: truncateUtf8(reasonCode, 512),
      scope: truncateUtf8(scope, 512),
    },
  };
  const line = JSON.stringify(event);
  return { line, bytes: Buffer.byteLength(line, 'utf8') };
}
