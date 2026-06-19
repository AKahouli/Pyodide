const SCRIPT_OPEN = '<script';
const SCRIPT_CLOSE = '</script>';

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

function removeScriptBlocks(input: string): string {
  const lower = input.toLowerCase();
  const parts: string[] = [];
  let index = 0;

  while (index < input.length) {
    const scriptStart = lower.indexOf(SCRIPT_OPEN, index);
    if (scriptStart === -1) {
      parts.push(input.slice(index));
      break;
    }

    parts.push(input.slice(index, scriptStart));
    const tagEnd = input.indexOf('>', scriptStart);
    if (tagEnd === -1) {
      index = scriptStart + 1;
      continue;
    }

    const closeStart = lower.indexOf(SCRIPT_CLOSE, tagEnd + 1);
    if (closeStart === -1) {
      index = tagEnd + 1;
      continue;
    }

    index = closeStart + SCRIPT_CLOSE.length;
  }

  return parts.join('');
}

function removeHtmlTags(input: string): string {
  const parts: string[] = [];
  let index = 0;

  while (index < input.length) {
    const tagStart = input.indexOf('<', index);
    if (tagStart === -1) {
      parts.push(input.slice(index));
      break;
    }

    parts.push(input.slice(index, tagStart));
    const tagEnd = input.indexOf('>', tagStart + 1);
    index = tagEnd === -1 ? tagStart + 1 : tagEnd + 1;
  }

  return parts.join('');
}

function removeJavascriptProtocol(input: string): string {
  const needle = 'javascript:';
  let result = '';
  let index = 0;

  while (index < input.length) {
    if (input.slice(index, index + needle.length).toLowerCase() === needle) {
      index += needle.length;
      continue;
    }
    result += input[index];
    index++;
  }

  return result;
}

function removeEventHandlerPatterns(input: string): string {
  const lower = input.toLowerCase();
  let result = '';
  let index = 0;

  while (index < input.length) {
    if (lower[index] === 'o' && lower[index + 1] === 'n') {
      let cursor = index + 2;
      while (cursor < input.length && isAsciiLetter(input[cursor])) {
        cursor++;
      }
      while (cursor < input.length && isAsciiWhitespace(input[cursor])) {
        cursor++;
      }
      if (input[cursor] === '=') {
        index = cursor + 1;
        continue;
      }
    }

    result += input[index];
    index++;
  }

  return result;
}

/**
 * Basic HTML sanitization for notification content.
 * Removes potentially dangerous HTML/script content using linear-time scans.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';

  return removeEventHandlerPatterns(
    removeJavascriptProtocol(removeHtmlTags(removeScriptBlocks(input))),
  ).trim();
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
