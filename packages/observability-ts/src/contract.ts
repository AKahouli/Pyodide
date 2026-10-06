import budgetsJson from './generated/budgets.v1.json';
import registryJson from './generated/log-events.v1.json';
import redactionJson from './generated/redaction.v1.json';
import severityJson from './generated/severity.v1.json';
import type { SeverityText } from './types';

export const BUDGETS = budgetsJson as {
  max_event_bytes: number;
  max_attributes: number;
  max_attribute_string_bytes: number;
  max_array_items: number;
  max_error_message_bytes: number;
  max_error_stack_bytes: number;
  max_error_stack_frames: number;
  max_error_cause_depth: number;
  max_queue_events: number;
  max_queue_bytes: number;
  error_reserve_bytes: number;
  shutdown_drain_ms: number;
};

interface RegistryEvent {
  message: string;
  attributes: string[];
}

const registry = registryJson as {
  attribute_vocabulary: string[];
  events: Record<string, RegistryEvent>;
};

export const EVENT_REGISTRY = registry.events;

export const REDACTION = redactionJson as {
  redacted_marker: string;
};

const SEVERITY_ROWS = severityJson.levels as Array<{
  text: SeverityText;
  number: number;
  nest: string;
}>;

export const SEVERITY_NUMBER: Record<SeverityText, number> = Object.fromEntries(
  SEVERITY_ROWS.map((r) => [r.text, r.number]),
) as Record<SeverityText, number>;

export const SEVERITY_ORDER: SeverityText[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export function severityAtLeast(level: SeverityText, threshold: SeverityText): boolean {
  return SEVERITY_ORDER.indexOf(level) >= SEVERITY_ORDER.indexOf(threshold);
}

/** Nest legacy level -> envelope severity (contracts/observability/severity.v1.json). */
export const NEST_LEVEL_MAP: Record<string, SeverityText> = Object.fromEntries(
  SEVERITY_ROWS.map((r) => [r.nest, r.text]),
);

const SENSITIVE = redactionJson.sensitive_key_rules as {
  substring: string[];
  exact: string[];
  suffix: string[];
};

const sensitiveSubstrings = SENSITIVE.substring.map((s) => s.toLowerCase());
const sensitiveExact = new Set(SENSITIVE.exact.map((s) => s.toLowerCase()));
const sensitiveSuffixes = SENSITIVE.suffix.map((s) => s.toLowerCase());

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (sensitiveExact.has(lower)) return true;
  if (sensitiveSuffixes.some((s) => lower.endsWith(s))) return true;
  return sensitiveSubstrings.some((s) => lower.includes(s));
}
