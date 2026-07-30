import { createHash } from 'crypto';

export interface RedactedUrlForLog {
  scheme: string;
  host: string;
  pathHash: string;
}

/**
 * Safe fields for structured logs. Discards query and fragment so signed /
 * tokenized download URLs (SharePoint SAS, etc.) cannot be recovered from logs.
 */
export function redactUrlForLog(rawUrl: string): RedactedUrlForLog {
  try {
    const u = new URL(rawUrl);
    return {
      scheme: u.protocol.replace(/:$/, ''),
      host: u.host,
      pathHash: createHash('sha256').update(u.pathname).digest('hex').slice(0, 12),
    };
  } catch {
    return {
      scheme: 'unknown',
      host: 'invalid',
      pathHash: createHash('sha256').update(rawUrl).digest('hex').slice(0, 12),
    };
  }
}

/** Strip absolute http(s) URLs from free-text error messages before logging. */
export function redactUrlsInMessage(message: string): string {
  return message.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]');
}
