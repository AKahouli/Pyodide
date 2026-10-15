import type { MessageComponent } from '../../types';
import { splitReportProgram } from './report-program';

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
  // The report chip (title, kind, View button) is not text; the report itself is read from the program (see the projector).
  if (element.hasAttribute('data-openui-report')) return '';
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

/**
 * Text-bearing calls of the thesys chat and report libraries: their string arguments are what a reader sees.
 * The names of the earlier react-ui chat library (CardHeader, Callout, SectionItem...) stay, so an answer stored
 * under it still projects.
 */
const TEXT_CALL = /\b(TextContent|MarkDownRenderer|TextCallout|Callout|CalloutV2|CardHeader|Header|InlineHeader|StepsItem|SectionItem|SectionBlockItem|FollowUpItem|FollowUpBlock|ListItem|EntityList|BoldText|IconText|Text|Report|ReportView|StandardFrontPage|MinimalFrontPage|DramaticFrontPage|TableOfContentsPage|Headline|HeadlineStatement|KeyStatement|KeyMetrics|HeroMetric|NumberedKeyPoint|VisualCards|FeatureHighlight|SummaryGrid|ProfileTile|DataTile|Stats)\(((?:"(?:[^"\\]|\\.)*"|[^()"])*)\)/g;
/** Leading string arguments that identify the call rather than say something (a section item's `value` id). */
const LEADING_ID_ARGUMENTS: Readonly<Record<string, number>> = { SectionItem: 1, SectionBlockItem: 1 };
/** Image sources (VisualCards, front pages) sit among the strings of a report call and say nothing. */
const IMAGE_URL = /^https?:\/\/\S+$/;
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g;
/** Enum arguments (size, variant) that sit beside the text and are not part of it. */
const ENUM_ARGUMENT = /^(?:(?:small|default|large)(?:-heavy)?|row|column|medium|icon|image|gray|cyan|navy|with-image|classic|expressive|title-(?:center|top|left|bottom)|(?:default|layout)(?:-with-image)?|info|warning|error|success|danger|neutral|inverted|filled|soft|clear|card|sunk|text|number|metric|horizontal|vertical|xs|sm|md|lg|xl|s|m|l)$/;

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
    .map((call) => Array.from(call[2].matchAll(STRING_LITERAL)).slice(LEADING_ID_ARGUMENTS[call[1]] ?? 0).map((literal) => decodeLiteral(literal[1]).trim()).filter((text) => text && !ENUM_ARGUMENT.test(text) && !IMAGE_URL.test(text)).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

/** Saved-program content, independent of mounted/collapsed components. Image references
 * stay opaque until the caller resolves them in the answer's authorized scope. */
export type OpenUiExportPart = { kind: 'markdown'; markdown: string } | { kind: 'image'; source: string; caption: string };

const CONTENT_FIELDS = new Set(['title', 'subtitle', 'heading', 'description', 'text', 'textMarkdown', 'body', 'content', 'label', 'trigger', 'helperText', 'author', 'value', 'subtext', 'left', 'right', 'metric', 'caption', 'headline', 'eyebrow', 'name', 'role', 'primaryText', 'secondaryText']);
const IMAGE_FIELDS = new Set(['src', 'imageSrc', 'bgImageSrc']);
const INTERACTIVE = /^(?:Action|Button|FollowUp|Form|Input|Select|Checkbox|Radio|Switch|Slider|DatePicker|TextArea|Query|Mutation)/;

/** Parsing never executes queries/mutations. Partial/dynamic content fails explicitly
 * rather than producing a plausible but incomplete document. */
export async function projectOpenUiProgram(program: string): Promise<OpenUiExportPart[]> {
  const [{ createParser }, { chatLibrary, reportLibrary, presentationLibrary }] = await Promise.all([
    import('@openuidev/lang-core'), import('@openuidev/thesys'),
  ]);
  const split = splitReportProgram(program);
  const parts: OpenUiExportPart[] = [];
  const add = (markdown: string) => { if (markdown.trim()) parts.push({ kind: 'markdown', markdown }); };
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
    throw new Error('Unsupported OpenUI export table cell');
  };
  const table = (headers: unknown[], rows: unknown[][]) => add([
    `| ${headers.map(cell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n'));
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 100) throw new Error('OpenUI export nesting limit');
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.partial || node.hasDynamicProps) throw new Error('Incomplete or dynamic OpenUI export');
    const name = typeof node.typeName === 'string' ? node.typeName : '';
    if (INTERACTIVE.test(name)) return;
    if (node.type && node.type !== 'element') throw new Error('Unsupported OpenUI export node');
    const props = (node.type === 'element' ? node.props : node) as Record<string, unknown>;
    if (!props || typeof props !== 'object') throw new Error('Invalid OpenUI export props');
    if (/ChartV2$/.test(name)) {
      const chartData = props.chartData as { data?: Record<string, unknown> | unknown[]; unit?: string } | undefined;
      const data = chartData?.data;
      walk({ type: 'element', typeName: name.replace(/V2$/, ''), props: {
        ...(Array.isArray(data) ? { slices: data } : data), unit: chartData?.unit, xLabel: props.xAxisLabel, yLabel: props.yAxisLabel,
      } }, depth + 1);
      return;
    }
    if (name === 'Table') {
      if (!Array.isArray(props.columns) || !Array.isArray(props.rows)) throw new Error('Incomplete OpenUI export table');
      table(props.columns.map((column) => typeof column === 'string' ? column : (column as { props?: { label?: unknown } })?.props?.label), props.rows as unknown[][]);
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.labels) && Array.isArray(props.series)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      add(`\`\`\`json\n${JSON.stringify({ chart: name, xLabel: props.xLabel, yLabel: props.yLabel, unit: props.unit, variant: props.variant })}\n\`\`\``);
      const series = props.series as Array<{ category?: string; values?: unknown[] }>;
      table(['', ...series.map((entry) => entry.category ?? '')], props.labels.map((label, index) => [label, ...series.map((entry) => entry.values?.[index])]));
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.slices)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      add(`\`\`\`json\n${JSON.stringify({ chart: name, unit: props.unit, variant: props.variant })}\n\`\`\``);
      table(['Category', 'Value'], (props.slices as Array<{ category: string; value: number }>).map((slice) => [slice.category, slice.value]));
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.datasets)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      add(`\`\`\`json\n${JSON.stringify({ chart: name, xLabel: props.xLabel, yLabel: props.yLabel, unit: props.unit })}\n\`\`\``);
      table(['Series', 'x', 'y', 'z'], (props.datasets as Array<{ name: string; points: Array<{ x: number; y: number; z?: number }> }>).flatMap((dataset) => dataset.points.map((point) => [dataset.name, point.x, point.y, point.z])));
      return;
    }
    if (/Chart$|SegmentedBar/.test(name)) throw new Error('Unsupported OpenUI chart export');
    // Galleries pair captions and sources by index; never reorder them by DOM visibility.
    if (name === 'ImageGallery') {
      const sources = props.imagesSrc;
      const captions = props.imagesAlt;
      if (!Array.isArray(sources) || !Array.isArray(captions) || sources.length !== captions.length) throw new Error('Unsupported OpenUI image gallery');
      sources.forEach((source, index) => {
        if (typeof source !== 'string') throw new Error('Invalid OpenUI image source');
        parts.push({ kind: 'image', source, caption: String(captions[index] ?? '') });
      });
      return;
    }
    for (const [key, entry] of Object.entries(props)) {
      if (IMAGE_FIELDS.has(key) && typeof entry === 'string' && entry) {
        parts.push({ kind: 'image', source: entry, caption: typeof props.alt === 'string' ? props.alt : typeof props.bgImageAlt === 'string' ? props.bgImageAlt : typeof props.title === 'string' ? props.title : '' });
      } else if (CONTENT_FIELDS.has(key) && (typeof entry === 'string' || typeof entry === 'number')) {
        if (key !== 'value' || ['Text', 'BoldText', 'HeroMetric', 'DataTile'].includes(name)) add(key === 'title' || key === 'heading' ? `## ${entry}` : String(entry));
      } else if (key === 'items' && Array.isArray(entry) && entry.every((item) => typeof item === 'string')) {
        add(entry.map((item) => `- ${item}`).join('\n'));
      } else if (entry && typeof entry === 'object') walk(entry, depth + 1);
    }
  };
  for (const source of [split.chat, split.report].filter((entry): entry is string => Boolean(entry))) {
    const library = /^\s*root\s*=\s*Presentation\(/.test(source) ? presentationLibrary : /^\s*root\s*=\s*Report\(/.test(source) ? reportLibrary : chatLibrary;
    const parsed = createParser(library.toJSONSchema()).parse(source);
    if (!parsed.root || parsed.meta.incomplete || parsed.meta.errors.length || parsed.meta.unresolved.length || Object.keys(parsed.stateDeclarations).length || parsed.queryStatements.length || parsed.mutationStatements.length) throw new Error('Invalid or interactive OpenUI export');
    walk(parsed.root);
  }
  return parts;
}

export function exportPartsToMarkdown(parts: readonly OpenUiExportPart[]): string {
  return parts.map((part) => part.kind === 'markdown' ? part.markdown : `![${part.caption.replace(/[\\\[\]]/g, '\\$&')}](${part.source.replaceAll('(', '%28').replaceAll(')', '%29')})`).join('\n\n');
}

const COLLAPSED_SECTION = '.openui-foldable-section-item[data-state="closed"]';

/** Plain text of the rendered OpenUI answer for one stored text component; undefined when none is on screen or sections are folded. */
function readRenderedPart(messageId: string, partId: string): 'fallback' | string | undefined {
  const message = document.getElementById(`message-${messageId}`);
  if (!message) return undefined;
  const scope = Array.from(message.querySelectorAll('[data-openui-scope]')).find((element) => element.getAttribute('data-openui-part') === partId);
  // A folded SectionBlock unmounts its closed sections, so the DOM no longer holds the whole answer.
  if (scope) return scope.querySelector(COLLAPSED_SECTION) ? undefined : domToPlainText(scope);
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
    if (rendered === undefined) return programToPlainText(content as string) || undefined;
    // The report is read in its panel, not in the message, so its text comes from the program.
    const { report } = splitReportProgram(content as string);
    return [rendered, report === null ? '' : programToPlainText(report)].filter(Boolean).join('\n\n') || undefined;
  };
}
