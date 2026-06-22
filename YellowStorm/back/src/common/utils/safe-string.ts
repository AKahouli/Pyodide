const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

function isAsciiWhitespace(char: string): boolean {
  return ASCII_WHITESPACE.has(char);
}

/**
 * Removes repeated trailing occurrences of a single character in O(n) time.
 */
export function stripTrailingChar(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Removes repeated leading occurrences of a single character in O(n) time.
 */
export function stripLeadingChar(value: string, char: string): string {
  let start = 0;
  while (start < value.length && value[start] === char) {
    start++;
  }
  return start === 0 ? value : value.slice(start);
}

/**
 * Removes repeated leading and trailing occurrences of a single character in O(n) time.
 */
export function stripLeadingTrailingChar(value: string, char: string): string {
  return stripTrailingChar(stripLeadingChar(value, char), char);
}

/**
 * Removes repeated leading and trailing characters from a set in O(n) time.
 */
export function stripLeadingTrailingChars(value: string, chars: string): string {
  const forbidden = new Set(chars);
  let start = 0;
  let end = value.length;
  while (start < end && forbidden.has(value[start])) {
    start++;
  }
  while (end > start && forbidden.has(value[end - 1])) {
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/**
 * Removes repeated leading and trailing whitespace or dot characters in O(n) time.
 */
export function stripLeadingTrailingWhitespaceOrDot(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === '.' || isAsciiWhitespace(value[start]))) {
    start++;
  }
  while (end > start && (value[end - 1] === '.' || isAsciiWhitespace(value[end - 1]))) {
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/**
 * Collapses consecutive occurrences of a single character into one in O(n) time.
 */
export function collapseRepeatedChar(value: string, char: string): string {
  if (!value.includes(char)) {
    return value;
  }

  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const current = value[index];
    parts.push(current);
    if (current === char) {
      while (index + 1 < value.length && value[index + 1] === char) {
        index++;
      }
    }
  }
  return parts.join('');
}

/**
 * Collapses consecutive whitespace characters into a replacement string in O(n) time.
 */
export function collapseWhitespace(value: string, replacement: string): string {
  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (isAsciiWhitespace(value[index])) {
      parts.push(replacement);
      while (index + 1 < value.length && isAsciiWhitespace(value[index + 1])) {
        index++;
      }
    } else {
      parts.push(value[index]);
    }
  }
  return parts.join('');
}

/**
 * Collapses consecutive characters from a set into a replacement string in O(n) time.
 */
export function collapseCharSet(value: string, chars: string, replacement: string): string {
  const allowed = new Set(chars);
  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (allowed.has(value[index])) {
      parts.push(replacement);
      while (index + 1 < value.length && allowed.has(value[index + 1])) {
        index++;
      }
    } else {
      parts.push(value[index]);
    }
  }
  return parts.join('');
}
