const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

function isAsciiWhitespace(char: string): boolean {
  return ASCII_WHITESPACE.has(char);
}

/** Strips trailing whitespace, an optional quote, then trailing whitespace. */
export function stripTrailingQuoteAndWhitespace(value: string): string {
  let end = value.length;
  while (end > 0 && isAsciiWhitespace(value[end - 1])) {
    end--;
  }
  if (end > 0 && value[end - 1] === '"') {
    end--;
  }
  while (end > 0 && isAsciiWhitespace(value[end - 1])) {
    end--;
  }
  return value.slice(0, end);
}

const REWRITE_PROMPT_PREFIXES = ['rewritten prompt', 'rewrite', 'prompt rewrite'];

/** Normalizes LLM rewrite output by removing code fences and label prefixes. */
export function normalizeRewritePromptText(text: string): string {
  let normalized = stripLeadingCodeFence(text);
  normalized = stripTrailingCodeFence(normalized);
  normalized = stripRewriteLabelPrefix(normalized);
  return normalized.trim();
}

function stripLeadingCodeFence(text: string): string {
  if (!text.toLowerCase().startsWith('```')) {
    return text;
  }

  let index = 3;
  if (text.slice(index, index + 4).toLowerCase() === 'text') {
    index += 4;
  }
  while (index < text.length && isAsciiWhitespace(text[index])) {
    index++;
  }
  return text.slice(index);
}

function stripTrailingCodeFence(text: string): string {
  let end = text.length;
  while (end > 0 && isAsciiWhitespace(text[end - 1])) {
    end--;
  }
  if (end >= 3 && text.slice(end - 3, end) === '```') {
    end -= 3;
    while (end > 0 && isAsciiWhitespace(text[end - 1])) {
      end--;
    }
  }
  return text.slice(0, end);
}

function stripRewriteLabelPrefix(text: string): string {
  const lower = text.toLowerCase();
  for (const prefix of REWRITE_PROMPT_PREFIXES) {
    if (!lower.startsWith(prefix)) {
      continue;
    }

    let index = prefix.length;
    while (index < text.length && isAsciiWhitespace(text[index])) {
      index++;
    }
    if (text[index] !== ':') {
      continue;
    }
    index++;
    while (index < text.length && isAsciiWhitespace(text[index])) {
      index++;
    }
    return text.slice(index);
  }
  return text;
}

/** Parses `question: label [metadata]` design-resource clarification lines. */
export function parseDesignResourceLine(
  line: string,
): { question: string; label: string; metadata: string } | null {
  const trimmed = line.trim();
  if (!trimmed.endsWith(']')) {
    return null;
  }

  const bracketStart = trimmed.lastIndexOf('[');
  if (bracketStart <= 0) {
    return null;
  }

  const metadata = trimmed.slice(bracketStart + 1, trimmed.length - 1).trim();
  const beforeBracket = trimmed.slice(0, bracketStart).trimEnd();
  const colonIndex = beforeBracket.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const question = beforeBracket.slice(0, colonIndex).trim();
  const label = beforeBracket.slice(colonIndex + 1).trim();
  if (!question || !label || !metadata) {
    return null;
  }

  return { question, label, metadata };
}

/** Extracts unique markdown heading titles from `#` through `######` lines. */
export function extractMarkdownHeadings(output: string): string[] {
  const headings: string[] = [];
  let lineStart = 0;

  for (let index = 0; index <= output.length; index++) {
    if (index === output.length || output[index] === '\n') {
      const heading = parseMarkdownHeadingLine(output.slice(lineStart, index));
      if (heading) {
        headings.push(heading);
      }
      lineStart = index + 1;
    }
  }

  return headings.filter((value, index, items) => items.indexOf(value) === index);
}

function parseMarkdownHeadingLine(line: string): string | null {
  if (!line.startsWith('#')) {
    return null;
  }

  let index = 0;
  let hashCount = 0;
  while (index < line.length && line[index] === '#' && hashCount < 6) {
    hashCount++;
    index++;
  }
  if (hashCount === 0 || index >= line.length || !isAsciiWhitespace(line[index])) {
    return null;
  }

  while (index < line.length && isAsciiWhitespace(line[index])) {
    index++;
  }

  const title = line.slice(index).trim();
  return title || null;
}

/** Detects numeric citations, markdown links, or http(s) URLs in text. */
export function hasCitationMarkersInText(text: string): boolean {
  if (containsHttpUrl(text)) {
    return true;
  }
  if (containsNumericBracketCitation(text)) {
    return true;
  }
  return containsMarkdownLink(text);
}

function containsHttpUrl(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('http://') || lower.includes('https://');
}

function containsNumericBracketCitation(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '[') {
      continue;
    }

    let cursor = index + 1;
    if (cursor >= text.length || text[cursor] < '0' || text[cursor] > '9') {
      continue;
    }

    while (cursor < text.length && text[cursor] >= '0' && text[cursor] <= '9') {
      cursor++;
    }

    if (cursor > index + 1 && text[cursor] === ']') {
      return true;
    }
  }

  return false;
}

function containsMarkdownLink(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '[') {
      continue;
    }

    const closeBracket = text.indexOf(']', index + 1);
    if (closeBracket === -1 || closeBracket === index + 1) {
      continue;
    }
    if (closeBracket + 1 >= text.length || text[closeBracket + 1] !== '(') {
      continue;
    }

    const closeParen = text.indexOf(')', closeBracket + 2);
    if (closeParen !== -1) {
      return true;
    }
  }

  return false;
}

/** Reads `include section: <name>` from the end of a contract description. */
export function extractRequiredSectionFromDescription(description: string): string | null {
  const marker = 'include section:';
  const markerIndex = description.toLowerCase().indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  let section = description.slice(markerIndex + marker.length);
  let index = 0;
  while (index < section.length && isAsciiWhitespace(section[index])) {
    index++;
  }
  section = section.slice(index).trimEnd();
  if (section.endsWith('.')) {
    section = section.slice(0, -1).trimEnd();
  }

  const trimmed = section.trim();
  return trimmed || null;
}
