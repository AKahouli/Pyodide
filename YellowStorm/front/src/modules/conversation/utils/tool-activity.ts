const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 20_000;
const MAX_SERIALIZED_PAYLOAD_LENGTH = 65_536;
const MAX_FORMATTED_PAYLOAD_LENGTH = 12_000;
const TRUNCATION_SUFFIX = '... [truncated]';
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|credentials?|password|passwd|secret|api[-_]?key|access[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|connection[-_]?string)$/i;
const UNSAFE_SUMMARY = /YELLOWSTORM_ATTACHMENT_SENTINEL_\d+|(?:^|[\s=:('\\"])(?:[A-Za-z]:[\\/]|\/|\\\\)\S+|(?:^|[\s=:('\\"])(?:[A-Za-z0-9._-]+\/){2,}[^\s"']+|\b(?:const|let|var|def|class|import|from)\s+[A-Za-z_$]|=>|[{};]/i;
const OPAQUE_IDENTIFIER = /(?:[a-f0-9]{24}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i;
const CREDENTIAL_VALUE = /(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:gh[opsu]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[A-Za-z0-9_+/=-]{32,}\b/;
const CREDENTIAL_VALUE_GLOBAL = new RegExp(CREDENTIAL_VALUE.source, 'g');
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

function boundText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}... [truncated]` : value;
}

function sanitizeText(value: string, redactSensitiveText = true): string {
  const redacted = value
    .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/gi, REDACTED)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/\b(authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|access[-_]?key|(?:access|refresh|id|client|api|session)[-_]?token|token|private[-_]?key|connection[-_]?string)\b(\s*[:=]\s*)(?:(?:Basic|Bearer)\s+)?[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)|sig|signature|credential)=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CONNECTION_STRING)[A-Z0-9_]*)\b(\s*=\s*)[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(CREDENTIAL_VALUE_GLOBAL, REDACTED);
  if (!redactSensitiveText) return boundText(redacted);
  const displayRedacted = redacted
    .replace(/(?:^|\s)[A-Za-z0-9_-]{8,}\/(?:runs?|workspaces?)\/[^\s"']+/gi, ` ${REDACTED}`);
  return boundText(displayRedacted);
}

function sanitizeToolDetailText(value: string, redactSensitiveText = true): string {
  const sanitized = sanitizeText(value, redactSensitiveText);
  if (!redactSensitiveText) return sanitized;
  return sanitized.includes(REDACTED) || UNSAFE_SUMMARY.test(sanitized) || OPAQUE_IDENTIFIER.test(sanitized)
    || CREDENTIAL_VALUE.test(sanitized) || URI_VALUE.test(sanitized) || CODE_VALUE.test(sanitized)
    ? REDACTED
    : sanitized;
}

export function sanitizeToolValue(value: unknown, depth = 0, redactSensitiveText = true): unknown {
  if (typeof value === 'string') return sanitizeToolDetailText(value, redactSensitiveText);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_ITEMS).map((item) => sanitizeToolValue(item, depth + 1, redactSensitiveText));
    if (value.length > MAX_ITEMS) items.push('[truncated]');
    return items;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).slice(0, MAX_ITEMS).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) || (redactSensitiveText && isPrivateToolDetailKey(key)) ? REDACTED : sanitizeToolValue(item, depth + 1, redactSensitiveText),
  ]));
}

export function formatSanitizedToolText(value: string | undefined, redactSensitiveText = true): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_SERIALIZED_PAYLOAD_LENGTH) return '[truncated]';
  try {
    const sanitized = sanitizeToolValue(JSON.parse(value), 0, redactSensitiveText);
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) && !Object.keys(sanitized).length) return undefined;
    const formatted = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);
    return formatted.length > MAX_FORMATTED_PAYLOAD_LENGTH
      ? `${formatted.slice(0, MAX_FORMATTED_PAYLOAD_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
      : formatted;
  } catch {
    return sanitizeToolDetailText(value, redactSensitiveText);
  }
}

export function sanitizeRunCodeInput(value: unknown, redactSensitiveText = true): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const sanitizedText = sanitizeText(value, redactSensitiveText);
  if (!redactSensitiveText) return sanitizedText.trim() || undefined;
  const sanitized = sanitizedText
    .replace(/(^|[\s=:('"`])(?:[A-Za-z]:[\\/]|\/|\\\\)[^\s"'`]+/gi, (_match, boundary: string) => `${boundary}${REDACTED}`)
    .replace(/(^|[\s=:('"`])(?:[A-Za-z0-9._-]+\/){2,}[^\s"'`]+/gi, (_match, boundary: string) => `${boundary}${REDACTED}`)
    .replace(/\b(?:s3|ceph|azure|file):\/\/[^\s"'`]+/gi, REDACTED)
    .replace(URI_VALUE, REDACTED)
    .replace(OPAQUE_IDENTIFIER, REDACTED)
    .replace(CREDENTIAL_VALUE_GLOBAL, REDACTED);
  return sanitized.trim() || undefined;
}

function isPrivateCodeInterpreterKey(key: string, preserveExecutableFields: boolean): boolean {
  const normalized = normalizeToolDetailKey(key);
  return SENSITIVE_KEY.test(key)
    || (!preserveExecutableFields && ['code', 'source_code', 'script', 'command'].includes(normalized))
    || /(?:^|_)(?:id|prompt|reasoning|thought|chain_of_thought|path|uri|url|stack|traceback|cwd|env|environment)(?:_|$)/.test(normalized);
}

function sanitizeCodeInterpreterValue(value: unknown, preserveExecutableFields: boolean, redactSensitiveText: boolean, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeRunCodeInput(value, redactSensitiveText) ?? '';
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => sanitizeCodeInterpreterValue(item, preserveExecutableFields, redactSensitiveText, depth + 1));
    if (value.length > MAX_ITEMS) items.push('[truncated]');
    return items;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) || (redactSensitiveText && isPrivateCodeInterpreterKey(key, preserveExecutableFields)) ? REDACTED : sanitizeCodeInterpreterValue(item, preserveExecutableFields, redactSensitiveText, depth + 1),
  ]));
}

function formatCodeInterpreterPayload(value: string | undefined, preserveExecutableFields = false, redactSensitiveText = true): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_SERIALIZED_PAYLOAD_LENGTH) return '[truncated]';
  try {
    return formatCodeInterpreterValue(JSON.parse(value), preserveExecutableFields, redactSensitiveText);
  } catch {
    return sanitizeRunCodeInput(value, redactSensitiveText);
  }
}

function formatCodeInterpreterValue(value: unknown, preserveExecutableFields: boolean, redactSensitiveText: boolean): string | undefined {
  const sanitized = sanitizeCodeInterpreterValue(value, preserveExecutableFields, redactSensitiveText);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) && !Object.keys(sanitized).length) return undefined;
  const formatted = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);
  return formatted.length > MAX_FORMATTED_PAYLOAD_LENGTH
    ? `${formatted.slice(0, MAX_FORMATTED_PAYLOAD_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
    : formatted;
}

export function isCodeInterpreterActivity(data: Record<string, unknown>): boolean {
  const name = normalizeToolName(asNonEmptyString(data.toolName) || asNonEmptyString(data.title) || '');
  return data.renderKind === 'run_code'
    || name === 'run_code'
    || name === 'python_interpreter'
    || name.startsWith('code_interpreter_');
}

export function resolveCodeInterpreterRequest(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  const primaryInput = sanitizeRunCodeInput(data.primaryInput, redactSensitiveText);
  if (primaryInput) return primaryInput;
  const rawParams = data.paramsJson ?? data.params;
  if (typeof rawParams === 'string' && rawParams.length > MAX_SERIALIZED_PAYLOAD_LENGTH) return '[truncated]';
  const params = parseToolParams(rawParams);
  if (!params) return formatCodeInterpreterPayload(asNonEmptyString(data.paramsJson), false, redactSensitiveText);
  for (const key of ['code', 'source_code', 'script', 'command']) {
    const executable = sanitizeRunCodeInput(params[key], redactSensitiveText);
    if (executable) return executable;
  }
  return formatCodeInterpreterValue(params, true, redactSensitiveText);
}

export function resolveCodeInterpreterResponse(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  return formatCodeInterpreterPayload(asNonEmptyString(data.resultJson), false, redactSensitiveText);
}

export function resolveToolRequest(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  return isCodeInterpreterActivity(data)
    ? resolveCodeInterpreterRequest(data, redactSensitiveText)
    : formatSanitizedToolText(asNonEmptyString(data.paramsJson), redactSensitiveText);
}

export function resolveToolResponse(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  return formatToolResponsePayload(data, asNonEmptyString(data.resultJson), redactSensitiveText);
}

/** Formats a tool result payload (inline or fetched on demand) for display. */
export function formatToolResponsePayload(data: Record<string, unknown>, rawResultJson: string | undefined, redactSensitiveText = true): string | undefined {
  return isCodeInterpreterActivity(data)
    ? formatCodeInterpreterPayload(rawResultJson, false, redactSensitiveText)
    : formatSanitizedToolText(rawResultJson, redactSensitiveText);
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
  code_interpreter_file_find: 'findFiles',
  code_interpreter_file_list: 'findFiles',
  code_interpreter_sandbox_create: 'createSandbox',
  code_interpreter_shell_exec: 'runCommand',
  code_interpreter_send_file_to_user: 'sendFile',
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

export function sanitizeActivityDescription(value: unknown, redactSensitiveText = true): string | undefined {
  const text = asNonEmptyString(value);
  if (!text || (redactSensitiveText && (UNSAFE_SUMMARY.test(text) || OPAQUE_IDENTIFIER.test(text)))) return undefined;
  const sanitized = sanitizeAssistantDisplayText(String(sanitizeToolValue(text, 0, redactSensitiveText)), redactSensitiveText)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized || sanitized.includes(REDACTED)) return undefined;
  return sanitized;
}

export function sanitizeActivitySummary(value: unknown, redactSensitiveText = true): string | undefined {
  const sanitized = sanitizeActivityDescription(value, redactSensitiveText);
  if (!sanitized) return undefined;
  return sanitized.length > 140 ? `${sanitized.slice(0, 137)}...` : sanitized;
}

export function sanitizeActivityDetail(value: unknown, redactSensitiveText = true): string | undefined {
  const text = asNonEmptyString(value);
  if (!text) return undefined;
  const sanitized = sanitizeToolValue(text, 0, redactSensitiveText);
  if (typeof sanitized !== 'string') return undefined;
  return sanitizeAssistantDisplayText(sanitized, redactSensitiveText).trim() || undefined;
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

export function resolveToolFallbackName(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  const explicit = asNonEmptyString(data.fallbackDisplayName);
  if (explicit) return sanitizeActivitySummary(explicit, redactSensitiveText);
  const name = asNonEmptyString(data.toolName) || asNonEmptyString(data.title);
  return name ? sanitizeActivitySummary(humanizeToolTitle(name), redactSensitiveText) : undefined;
}

export function resolveToolShortName(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  const fullName = resolveToolFallbackName(data, redactSensitiveText);
  if (!fullName) return undefined;
  const paddleMarker = fullName.toLowerCase().lastIndexOf(' paddle ');
  if (paddleMarker < 0) return fullName;
  const shortName = fullName.slice(paddleMarker + ' paddle '.length);
  return `${shortName.charAt(0)}${shortName.slice(1).toLowerCase()}`;
}

export function resolveToolSummary(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  return sanitizeActivitySummary(data.summary, redactSensitiveText);
}

export function resolveToolDescription(data: Record<string, unknown>, redactSensitiveText = true): string | undefined {
  return sanitizeActivityDescription(data.summary, redactSensitiveText);
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

export function sanitizeAssistantDisplayText(value: string, redactSensitiveText = true): string {
  const withoutSentinels = value
    .replace(/\{[^{}\r\n]*"content"\s*:\s*"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?"[^{}\r\n]*\}/g, '')
    .replace(/YELLOWSTORM_ATTACHMENT_SENTINEL_\d+(?:\\n)?/g, '');
  return redactSensitiveText
    ? withoutSentinels.replace(/\/workspace(?:\/[^\s"'`)<>{}\]]+)*/g, REDACTED)
    : sanitizeText(withoutSentinels, false);
}
