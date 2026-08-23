const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 20_000;
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|credentials?|password|passwd|secret|api[-_]?key|access[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|connection[-_]?string)$/i;
const UNSAFE_SUMMARY = /YELLOWSTORM_ATTACHMENT_SENTINEL_\d+|(?:^|[\s=:('\\"])(?:[A-Za-z]:[\\/]|\/|\\\\)\S+|(?:^|[\s=:('\\"])(?:[A-Za-z0-9._-]+\/){2,}[^\s"']+|\b(?:const|let|var|def|class|import|from)\s+[A-Za-z_$]|=>|[{};]/i;
const OPAQUE_IDENTIFIER = /(?:[a-f0-9]{24}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i;
const CREDENTIAL_VALUE = /(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:gh[opsu]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[A-Za-z0-9_+/=-]{32,}\b/;
const URI_VALUE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/i;
const CODE_VALUE = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\r\n]*\)|\b[A-Za-z_$][\w$]*\s*=\s*[^,\r\n]+|<\/?(?:script|style|html)\b|\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]+\b(?:FROM|INTO|SET)\b/i;

function normalizeToolDetailKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function isPrivateToolDetailKey(key: string): boolean {
  const normalized = normalizeToolDetailKey(key);
  return SENSITIVE_KEY.test(key)
    || /(?:^|_)(?:id|code|source_code|script|prompt|reasoning|thought|chain_of_thought|path|uri|url|stack|traceback|command|cwd|env|environment)(?:_|$)/.test(normalized);
}

function sanitizeText(value: string): string {
  const redacted = value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/\b(authorization)\b(\s*[:=]\s*)(?!Bearer\s+)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b(password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|connection[-_]?string)\b(\s*[:=]\s*)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/(?:^|\s)[A-Za-z0-9_-]{8,}\/(?:runs?|workspaces?)\/[^\s"']+/gi, ` ${REDACTED}`);
  return redacted.length > MAX_TEXT_LENGTH ? `${redacted.slice(0, MAX_TEXT_LENGTH)}... [truncated]` : redacted;
}

function sanitizeToolDetailText(value: string): string {
  const sanitized = sanitizeText(value);
  return sanitized.includes(REDACTED) || UNSAFE_SUMMARY.test(sanitized) || OPAQUE_IDENTIFIER.test(sanitized)
    || CREDENTIAL_VALUE.test(sanitized) || URI_VALUE.test(sanitized) || CODE_VALUE.test(sanitized)
    ? REDACTED
    : sanitized;
}

export function sanitizeToolValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeToolDetailText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_ITEMS).map((item) => sanitizeToolValue(item, depth + 1));
    if (value.length > MAX_ITEMS) items.push('[truncated]');
    return items;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).slice(0, MAX_ITEMS).map(([key, item]) => [
    key,
    isPrivateToolDetailKey(key) ? REDACTED : sanitizeToolValue(item, depth + 1),
  ]));
}

export function formatSanitizedToolText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const sanitized = sanitizeToolValue(JSON.parse(value));
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) && !Object.keys(sanitized).length) return undefined;
    return typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);
  } catch {
    return sanitizeToolDetailText(value);
  }
}

export function sanitizeRunCodeInput(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const sanitized = sanitizeText(value)
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|tmp|workspace|users?)\/|\\\\)[^\s"'`]+/gi, REDACTED)
    .replace(/\b(?:s3|ceph|azure|file):\/\/[^\s"'`]+/gi, REDACTED)
    .replace(OPAQUE_IDENTIFIER, REDACTED);
  return sanitized.trim() || undefined;
}

export type ToolRenderKind = 'generic' | 'run_code' | 'search' | 'document' | 'file' | 'web';

export function resolveToolRenderKind(title: string): ToolRenderKind {
  const normalized = title.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'run_code') return 'run_code';
  if (normalized.includes('search')) return normalized.includes('web') ? 'web' : 'search';
  if (normalized.includes('document')) return 'document';
  if (normalized.includes('file')) return 'file';
  return 'generic';
}

export function humanizeToolTitle(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (character) => character.toUpperCase());
}

const TOOL_DISPLAY_KEYS: Record<string, string> = {
  run_code: 'runCode',
  python_interpreter: 'runCode',
  perform_document_search: 'searchKnowledge',
  perform_filtered_search: 'searchKnowledge',
  preform_all_brain_search: 'searchKnowledge',
  perform_web_search: 'searchWeb',
  perform_standard_search: 'search',
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseToolParams(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeActivitySummary(value: unknown): string | undefined {
  const text = asNonEmptyString(value);
  if (!text || UNSAFE_SUMMARY.test(text) || OPAQUE_IDENTIFIER.test(text)) return undefined;
  const sanitized = sanitizeAssistantDisplayText(String(sanitizeToolValue(text)))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized || sanitized.includes(REDACTED)) return undefined;
  return sanitized.length > 140 ? `${sanitized.slice(0, 137)}...` : sanitized;
}

export function resolveToolDisplayKey(data: Record<string, unknown>): string | undefined {
  const explicit = asNonEmptyString(data.displayKey);
  if (explicit) return explicit;
  const name = asNonEmptyString(data.toolName) || asNonEmptyString(data.title);
  if (!name) return undefined;
  const normalized = normalizeToolName(name);
  if (TOOL_DISPLAY_KEYS[normalized]) return TOOL_DISPLAY_KEYS[normalized];
  if (normalized.includes('glob') || normalized.includes('find_file') || normalized.includes('list_file')) return 'findFiles';
  if (normalized.includes('read')) return 'read';
  if (normalized.includes('write')) return 'write';
  if (normalized.includes('copy')) return 'copy';
  return undefined;
}

export function resolveToolFallbackName(data: Record<string, unknown>): string | undefined {
  const explicit = asNonEmptyString(data.fallbackDisplayName);
  if (explicit) return sanitizeActivitySummary(explicit);
  const name = asNonEmptyString(data.toolName) || asNonEmptyString(data.title);
  return name ? sanitizeActivitySummary(humanizeToolTitle(name)) : undefined;
}

export function resolveToolSummary(data: Record<string, unknown>): string | undefined {
  const explicit = sanitizeActivitySummary(data.summary) || sanitizeActivitySummary(data.description);
  if (explicit) return explicit;

  const name = normalizeToolName(asNonEmptyString(data.toolName) || asNonEmptyString(data.title) || '');
  const params = parseToolParams(data.paramsJson ?? data.params);
  if (!params) return undefined;
  if (name === 'run_code' || name === 'python_interpreter') return sanitizeActivitySummary(params.description);
  if (name.includes('search')) return sanitizeActivitySummary(params.query);
  if (name.includes('glob') || name.includes('find_file') || name.includes('list_file')) {
    return sanitizeActivitySummary(params.pattern ?? params.query);
  }
  if (name.includes('read') || name.includes('write') || name.includes('copy')) {
    const path = asNonEmptyString(params.path) || asNonEmptyString(params.file_path) || asNonEmptyString(params.source);
    return path ? sanitizeActivitySummary(path.replace(/\\/g, '/').split('/').at(-1)) : undefined;
  }
  return undefined;
}

export function sanitizeActivityActorName(value: unknown): string | undefined {
  return sanitizeActivitySummary(value);
}

export function sanitizeActivityFilename(value: unknown): string | undefined {
  const filename = asNonEmptyString(value)?.replace(/\\/g, '/').split('/').at(-1);
  return sanitizeActivitySummary(filename);
}

export function formatActivityDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function sanitizeAssistantDisplayText(value: string): string {
  return value
    .replace(/\{[^{}\r\n]*"content"\s*:\s*"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?"[^{}\r\n]*\}/g, '')
    .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, '')
    .replace(/\/workspace(?:\/[^\s"'`)<>{}\]]+)*/g, REDACTED);
}
