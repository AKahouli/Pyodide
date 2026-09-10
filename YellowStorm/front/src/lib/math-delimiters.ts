/**
 * Convert LaTeX math delimiters (`\[ ... \]` display, `\( ... \)` inline) to
 * `$$` delimiters understood by remark-math, so model-emitted LaTeX renders
 * through KaTeX. Single-dollar text math is disabled in the renderer because
 * it conflicts with currency, while `$$...$$` still supports inline math.
 *
 * Fenced code blocks and inline code spans are copied verbatim (LaTeX examples
 * shown as code must stay literal), and an unclosed delimiter — the normal
 * state of a streaming tail — is left as-is until its counterpart arrives.
 */

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

function lineEndOf(markdown: string, from: number): number {
  const newline = markdown.indexOf('\n', from);
  return newline === -1 ? markdown.length : newline + 1;
}

/** Copies a math span; empty content is left verbatim. */
function convertSpan(markdown: string, start: number, open: string, close: string, wrapper: (inner: string) => string): { replacement: string; next: number } | null {
  const closeIndex = markdown.indexOf(close, start + open.length);
  if (closeIndex === -1) return null;
  const inner = markdown.slice(start + open.length, closeIndex).trim();
  if (!inner) return null;
  return { replacement: wrapper(inner), next: closeIndex + close.length };
}

export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('\\[') && !markdown.includes('\\(')) return markdown;
  let result = '';
  let i = 0;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  while (i < markdown.length) {
    if (inFence) {
      const lineEnd = lineEndOf(markdown, i);
      const line = markdown.slice(i, lineEnd);
      result += line;
      const closing = CLOSING_FENCE.exec(line);
      if (closing && closing[1][0] === fenceChar && closing[1].length >= fenceLength) inFence = false;
      i = lineEnd;
      continue;
    }
    const atLineStart = i === 0 || markdown[i - 1] === '\n';
    // A run of 3+ backticks/tildes at line start always opens a fence, even
    // though it also looks like an inline code span opener.
    const fenceMatch = atLineStart ? OPENING_FENCE.exec(markdown.slice(i, i + 12)) : null;
    if (fenceMatch) {
      const lineEnd = lineEndOf(markdown, i);
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLength = fenceMatch[1].length;
      result += markdown.slice(i, lineEnd);
      i = lineEnd;
      continue;
    }
    if (markdown[i] === '`') {
      let runEnd = i;
      while (markdown[runEnd] === '`') runEnd += 1;
      const run = markdown.slice(i, runEnd);
      const close = markdown.indexOf(run, runEnd);
      if (close !== -1) {
        result += markdown.slice(i, close + run.length);
        i = close + run.length;
      } else {
        // A stray unclosed backtick must not disable conversion downstream.
        result += run;
        i = runEnd;
      }
      continue;
    }
    // `\\` is a markdown-escaped backslash, never a math delimiter opener.
    if (markdown[i] === '\\' && markdown[i + 1] === '\\') {
      result += '\\\\';
      i += 2;
      continue;
    }
    const span = markdown.startsWith('\\(', i)
      ? convertSpan(markdown, i, '\\(', '\\)', (inner) => `$$${inner}$$`)
      : markdown.startsWith('\\[', i)
        ? convertSpan(markdown, i, '\\[', '\\]', (inner) => `$$\n${inner}\n$$`)
        : null;
    if (span) {
      result += span.replacement;
      i = span.next;
      continue;
    }
    result += markdown[i];
    i += 1;
  }
  return result;
}
