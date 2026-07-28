const CREDENTIAL_KEY = '(?:api(?:[\\s_-]+)?key|access(?:[\\s_-]+)?token|refresh(?:[\\s_-]+)?token|id(?:[\\s_-]+)?token|token|password|passwd|secret|client(?:[\\s_-]+)?secret|connection(?:[\\s_-]+)?string)';

export function redactTaskDiagnosticText(value: string): string {
  return value
    .slice(0, 30_000)
    .replace(/(authorization\s*:\s*)(?:bearer|basic)\s+[^\s<]+/gi, '$1[REDACTED]')
    .replace(/(cookie\s*:\s*)[^\r\n<]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(new RegExp(`(${CREDENTIAL_KEY}\\s*["']?\\s*[:=]\\s*["']?)[^\\s"',}<;&]+`, 'gi'), '$1[REDACTED]');
}

export function sanitizeTaskDiagnosticItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === 'string')
    .map(redactTaskDiagnosticText)
    .filter(Boolean)
    .slice(0, 20);
}
