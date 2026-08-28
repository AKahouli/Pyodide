import { MessageComponent } from '../interfaces/message.interface';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;
const CREDENTIAL_VALUE = /(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:gh[opsu]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/g;

const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|connection[-_]?string)[A-Za-z0-9_-]*)$/i;

interface SanitizerOptions {
  redactSensitiveText?: boolean;
  includeAgentDetail?: boolean;
}

function boundString(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}... [truncated]`
    : value;
}

function sanitizeString(value: string, options: SanitizerOptions = {}): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(sanitizeValue(JSON.parse(value), 0, options));
    } catch {
      // Fall through to bounded text sanitization.
    }
  }

  const redacted = value
    .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, REDACTED)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/\b(authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|access[-_]?key|(?:access|refresh|id|client|api|session)[-_]?token|token|private[-_]?key|connection[-_]?string)\b(\s*[:=]\s*)(?:(?:Basic|Bearer)\s+)?[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)|sig|signature|credential)=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CONNECTION_STRING)[A-Z0-9_]*)\b(\s*=\s*)[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(CREDENTIAL_VALUE, REDACTED);

  if (options.redactSensitiveText === false) return boundString(redacted);

  const displayRedacted = redacted
    .replace(/\/workspace(?:\/[^\s"'`)<>{}\]]+)*/g, REDACTED)
    .replace(/(^|[\s=:('"`])(?:[A-Za-z]:[\\/]|\/|\\\\)[^\s"'`]+/gi, (_match, boundary: string) => `${boundary}${REDACTED}`)
    .replace(/(^|[\s=:('"`])(?:[A-Za-z0-9._-]+\/){2,}[^\s"'`]+/gi, (_match, boundary: string) => `${boundary}${REDACTED}`);

  return boundString(displayRedacted);
}

export function sanitizeSerializedToolValue(value: string, options?: SanitizerOptions): string {
  return sanitizeString(value, options);
}

function sanitizeValue(value: unknown, depth: number, options: SanitizerOptions): unknown {
  if (typeof value === 'string') return sanitizeString(value, options);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitizeValue(item, depth + 1, options));
    if (value.length > MAX_COLLECTION_ITEMS) items.push('[truncated]');
    return items;
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).slice(0, MAX_COLLECTION_ITEMS)) {
    sanitized[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeValue(item, depth + 1, options);
  }
  if (Object.keys(record).length > MAX_COLLECTION_ITEMS) sanitized.__truncated__ = true;
  return sanitized;
}

export function sanitizePublicToolData(data: Record<string, unknown>, options: SanitizerOptions = {}): Record<string, unknown> {
  return sanitizeValue(data, 0, options) as Record<string, unknown>;
}

export function sanitizePublicComponent(component: MessageComponent, options: SanitizerOptions = {}): MessageComponent {
  if (component.type === 'artifact') {
    const { storagePath: _storagePath, filePath: _filePath, file_path: _filePathSnake, ...publicData } = component.data;
    return { id: component.id, type: component.type, data: sanitizePublicToolData(publicData, options) };
  }
  if (component.type === 'text' && typeof component.data.content === 'string') {
    const content = component.data.content
      .replace(/\{[^{}\r\n]*"content"\s*:\s*"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?"[^{}\r\n]*\}/g, '')
      .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, '');
    return {
      id: component.id,
      type: component.type,
      data: sanitizePublicToolData({ ...component.data, content }, options),
    };
  }
  if (component.type === 'agentActivity') {
    const { detail, ...publicData } = component.data;
    const sanitized = sanitizePublicToolData(publicData, options);
    if (options.includeAgentDetail && typeof detail === 'string') sanitized.detail = detail;
    return { id: component.id, type: component.type, data: sanitized };
  }
  return {
    id: component.id,
    type: component.type,
    data: sanitizePublicToolData(component.data, options),
  };
}
