import type { MessageComponent } from '../../types';

/** An OpenUI Lang program always opens with its `root = Component(...)` statement. */
const OPENUI_PROGRAM = /^\s*root\s*=\s*[A-Z]\w*\(/m;

export function isOpenUiProgram(content: unknown): boolean {
  return typeof content === 'string' && OPENUI_PROGRAM.test(content);
}

const BLOCK_TAGS = new Set(['address', 'article', 'blockquote', 'div', 'dl', 'dt', 'dd', 'fieldset', 'figure', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'thead', 'ul']);
const SKIPPED_TAGS = new Set(['script', 'style', 'svg', 'canvas', 'textarea', 'input', 'select']);

function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  const tag = element.localName;
  if (SKIPPED_TAGS.has(tag) || element.getAttribute('aria-hidden') === 'true') return '';
  const reference = element.getAttribute('data-citation-ref');
  if (reference) return `[${reference}]`;
  if (tag === 'br') return '\n';
  if (tag === 'tr') {
    return `\n${Array.from(element.children).map((cell) => textOf(cell).replace(/\s+/g, ' ').trim()).join(' | ')}`;
  }
  const inner = Array.from(element.childNodes).map(textOf).join('');
  if (tag === 'li') return `\n- ${inner.trim()}`;
  return BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
}

/**
 * Readable text of what an OpenUI answer shows: block structure becomes line
 * breaks, table rows become `a | b | c`, charts and inputs are left out and a
 * rendered citation chip becomes its `[n]` marker again.
 */
export function domToPlainText(root: Element): string {
  return textOf(root)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text-bearing calls of the stock library: their string arguments are what a reader sees. */
const TEXT_CALL = /\b(TextContent|MarkDownRenderer|Callout|CardHeader|InlineHeader|StepsItem)\(((?:"(?:[^"\\]|\\.)*"|[^()"])*)\)/g;
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g;
/** Enum arguments (size, variant) that sit beside the text and are not part of it. */
const ENUM_ARGUMENT = /^(?:(?:small|default|large)(?:-heavy)?|info|warning|error|success|neutral|clear|card|sunk)$/;

function decodeLiteral(inner: string): string {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return inner;
  }
}

/**
 * Best effort when an OpenUI program is not rendered (a message that is not on screen): the
 * strings of its text-bearing components, so an export still reads as prose rather than as code.
 */
export function programToPlainText(program: string): string {
  return Array.from(program.matchAll(TEXT_CALL))
    .map((call) => Array.from(call[2].matchAll(STRING_LITERAL)).map((literal) => decodeLiteral(literal[1]).trim()).filter((text) => text && !ENUM_ARGUMENT.test(text)).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

/** Plain text of the rendered OpenUI answer for one stored text component; undefined when none is on screen. */
function readRenderedPart(messageId: string, partId: string): 'fallback' | string | undefined {
  const message = document.getElementById(`message-${messageId}`);
  if (!message) return undefined;
  const scope = Array.from(message.querySelectorAll('[data-openui-scope]')).find((element) => element.getAttribute('data-openui-part') === partId);
  if (scope) return domToPlainText(scope);
  const fellBack = Array.from(message.querySelectorAll('[data-openui-fallback]')).some((element) => element.getAttribute('data-openui-fallback') === partId);
  return fellBack ? 'fallback' : undefined;
}

/**
 * Copy/export projection for OpenUI answers: copying the raw program would paste `root = Stack([...])`.
 * Each stored text component is matched, by id, to the answer rendered for it:
 * - rendered: the readable text read back from the DOM (blocks, `a | b` rows, `[n]` chips);
 * - shown as markdown after a render failure: undefined, since the stored text is what the reader sees;
 * - not on screen: a best-effort projection of the program's own strings.
 * Plain prose parts are not programs and keep their stored text.
 */
export function createOpenUiTextProjector(messageId: string, components: readonly MessageComponent[]): ((component: MessageComponent) => string | undefined) | undefined {
  if (!components.some((component) => component.type === 'text' && isOpenUiProgram(component.data?.content))) return undefined;
  return (component) => {
    const content = component.data?.content;
    if (component.type !== 'text' || !isOpenUiProgram(content)) return undefined;
    const rendered = typeof component.id === 'string' ? readRenderedPart(messageId, component.id) : undefined;
    if (rendered === 'fallback') return undefined;
    return (rendered ?? programToPlainText(content as string)) || undefined;
  };
}
