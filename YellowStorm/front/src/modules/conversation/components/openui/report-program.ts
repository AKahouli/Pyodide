/**
 * An answer can carry two OpenUI Lang programs: the chat program (`root = Card(...)`) and, after
 * it, a report (`root = Report(...)`). The two libraries share component names with different
 * schemas (InlineHeader, TextContent, Table...), so each program is parsed on its own.
 */
const REPORT_ROOT = /^[ \t]*root[ \t]*=[ \t]*Report[ \t]*\(/m;
const REPORT_ROOT_TEXT = 'root=Report(';
/** "root" is the shortest prefix held back: shorter ones are indistinguishable from any chat statement name. */
const MIN_PARTIAL_LENGTH = 'root'.length;

export interface SplitProgram {
  /** The chat program; empty when the answer is only a report. */
  chat: string;
  /** The report program, from its `root = Report(` line to the end; null when the answer has none. */
  report: string | null;
}

/**
 * While streaming, the second program's root line arrives piecemeal (`root`, `root =`, `root = Rep`).
 * A trailing line that is still a proper prefix of `root = Report(` is the start of the report, not
 * chat text: it is held back so the chat card does not flicker. The first line is exempt, it is the chat root.
 */
function partialReportStart(content: string): number | null {
  const lineStart = content.lastIndexOf('\n') + 1;
  if (lineStart === 0) return null;
  const compact = content.slice(lineStart).replaceAll(/\s+/g, '');
  const isPrefix = compact.length >= MIN_PARTIAL_LENGTH && compact.length < REPORT_ROOT_TEXT.length && REPORT_ROOT_TEXT.startsWith(compact);
  return isPrefix ? lineStart : null;
}

export function splitReportProgram(content: string): SplitProgram {
  const match = REPORT_ROOT.exec(content);
  if (match) return { chat: content.slice(0, match.index).trimEnd(), report: content.slice(match.index).trimStart() };
  const partial = partialReportStart(content);
  if (partial !== null) return { chat: content.slice(0, partial).trimEnd(), report: null };
  return { chat: content, report: null };
}
