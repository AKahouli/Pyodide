/**
 * Basic HTML sanitization for notification content
 * Removes potentially dangerous HTML/script content
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';

  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/**
 * Validate notification payload size
 * @param data - Data to check
 * @param maxBytes - Maximum allowed size in bytes (default 10KB)
 */
export function validatePayloadSize(
  data: unknown,
  maxBytes: number = 10240,
): boolean {
  try {
    const jsonString = JSON.stringify(data);
    const size = Buffer.byteLength(jsonString, 'utf8');
    return size <= maxBytes;
  } catch {
    return false;
  }
}

/**
 * Sanitize notification data object
 * Recursively sanitizes string values
 */
export function sanitizeNotificationData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeHtml(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'string'
          ? sanitizeHtml(item)
          : typeof item === 'object' && item !== null
            ? sanitizeNotificationData(item as Record<string, unknown>)
            : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeNotificationData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
