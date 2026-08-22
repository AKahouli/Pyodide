const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 20_000;
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|connection[-_]?string)$/i;

function sanitizeText(value: string): string {
  const redacted = value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/\b(authorization)\b(\s*[:=]\s*)(?!Bearer\s+)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b(password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|connection[-_]?string)\b(\s*[:=]\s*)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`);
  return redacted.length > MAX_TEXT_LENGTH ? `${redacted.slice(0, MAX_TEXT_LENGTH)}... [truncated]` : redacted;
}

export function sanitizeToolValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeText(value);
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
    SENSITIVE_KEY.test(key) ? REDACTED : sanitizeToolValue(item, depth + 1),
  ]));
}

export function formatSanitizedToolText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return JSON.stringify(sanitizeToolValue(JSON.parse(value)), null, 2);
  } catch {
    return sanitizeText(value);
  }
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
