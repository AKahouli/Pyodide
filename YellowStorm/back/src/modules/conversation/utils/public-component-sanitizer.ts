import { MessageComponent } from '../interfaces/message.interface';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;

const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|connection[-_]?string)$/i;

function sanitizeString(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(sanitizeValue(JSON.parse(value), 0));
    } catch {
      // Fall through to bounded text sanitization.
    }
  }

  const redacted = value
    .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, REDACTED)
    .replace(/\/workspace(?:\/[^\s"'`)<>{}\]]+)*/g, REDACTED)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/\b(authorization)\b(\s*[:=]\s*)(?!Bearer\s+)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b(password|passwd|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|connection[-_]?string)\b(\s*[:=]\s*)([^\s,;]+)/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/(?:^|\s)[A-Za-z0-9_-]{8,}\/(?:runs?|workspaces?)\/[^\s"']+/gi, ` ${REDACTED}`);

  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}... [truncated]`
    : redacted;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_COLLECTION_ITEMS) items.push('[truncated]');
    return items;
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, MAX_COLLECTION_ITEMS)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(item, depth + 1);
  }
  if (Object.keys(record).length > MAX_COLLECTION_ITEMS) sanitized.__truncated__ = true;
  return sanitized;
}

export function sanitizePublicToolData(data: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(data, 0) as Record<string, unknown>;
}

export function sanitizePublicComponent(component: MessageComponent): MessageComponent {
  if (component.type === 'artifact') {
    const { storagePath: _storagePath, filePath: _filePath, file_path: _filePathSnake, ...publicData } = component.data;
    return { id: component.id, type: component.type, data: sanitizePublicToolData(publicData) };
  }
  if (component.type === 'text' && typeof component.data.content === 'string') {
    const content = component.data.content
      .replace(/\{[^{}\r\n]*"content"\s*:\s*"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?"[^{}\r\n]*\}/g, '')
      .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, '');
    return {
      id: component.id,
      type: component.type,
      data: sanitizePublicToolData({ ...component.data, content }),
    };
  }
  if (component.type === 'reasoning') {
    const { detail: _detail, ...publicData } = component.data;
    return { id: component.id, type: component.type, data: sanitizePublicToolData(publicData) };
  }
  return {
    id: component.id,
    type: component.type,
    data: sanitizePublicToolData(component.data),
  };
}
