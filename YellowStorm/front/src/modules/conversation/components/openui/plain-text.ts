import type { MessageComponent } from '../../types';
import { splitReportProgram } from './report-program';
import { getChartData, getTableRows, tableView } from './data-exploration';
import { svgDefinitions } from './svg-definitions';
import { HtmlView } from './html-view-definition';
import { askAgentAction, miniAppDefinitions } from './mini-app-definitions';
import { miniAppFunctions } from './mini-app-functions';
import { dashboardFunctions } from './dashboard-functions';
import { miniAppStateSignature, validateMiniAppState } from './mini-app-state';
import type { MiniAppStateIdentity } from './mini-app-state';

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
const TEXT_CALL = /\b(MiniText|TextContent|MarkDownRenderer|TextCallout|Callout|CalloutV2|CardHeader|Header|InlineHeader|StepsItem|SectionItem|SectionBlockItem|FollowUpItem|FollowUpBlock|ListItem|EntityList|BoldText|IconText|Text|Report|ReportView|StandardFrontPage|MinimalFrontPage|DramaticFrontPage|TableOfContentsPage|Headline|HeadlineStatement|KeyStatement|KeyMetrics|HeroMetric|NumberedKeyPoint|VisualCards|FeatureHighlight|SummaryGrid|ProfileTile|DataTile|Stats)\(((?:"(?:[^"\\]|\\.)*"|[^()"])*)\)/g;
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
    .map((call) => {
      if (call[1] === 'MiniText') {
        const literal = /^\s*"((?:[^"\\]|\\.)*)"\s*(?:,|$)/.exec(call[2]);
        return literal ? decodeLiteral(literal[1]).trim() : '';
      }
      return Array.from(call[2].matchAll(STRING_LITERAL)).slice(LEADING_ID_ARGUMENTS[call[1]] ?? 0).map((literal) => decodeLiteral(literal[1]).trim()).filter((text) => text && !ENUM_ARGUMENT.test(text) && !IMAGE_URL.test(text)).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Saved-program content, independent of mounted/collapsed components. Image references
 * stay opaque until the caller resolves them in the answer's authorized scope. */
export type OpenUiExportPart = { kind: 'markdown'; markdown: string } | { kind: 'image'; source: string; caption: string };
/** The host supplies only an acknowledged private state and separately authorized references. */
export interface OpenUiReactiveExportSnapshot {
  reactiveState: Record<string, unknown>;
  identity?: MiniAppStateIdentity;
  stateRevision?: number;
  documents?: Record<string, string>;
  taskResults?: Record<string, { inputs: Record<string, unknown>; parts: OpenUiExportPart[] }>;
}

const CONTENT_FIELDS = new Set(['title', 'subtitle', 'heading', 'description', 'text', 'textMarkdown', 'body', 'content', 'label', 'trigger', 'helperText', 'author', 'value', 'subtext', 'left', 'right', 'metric', 'caption', 'headline', 'eyebrow', 'name', 'role', 'primaryText', 'secondaryText']);
const IMAGE_FIELDS = new Set(['src', 'imageSrc', 'bgImageSrc']);
const INTERACTIVE = /^(?:Action|Button|FollowUp|Form|Input|Select|Checkbox|Radio|Switch|Slider|DatePicker|TextArea|Query|Mutation)/;

/** Parsing never executes queries/mutations. Partial/dynamic content fails explicitly
 * rather than producing a plausible but incomplete document. */
export async function projectOpenUiProgram(program: string, viewState?: Record<string, unknown>, renderChart?: (name: string, props: Record<string, unknown>) => Promise<string>, snapshot?: OpenUiReactiveExportSnapshot, renderHtml?: (props: Record<string, unknown>) => Promise<OpenUiExportPart[]>): Promise<OpenUiExportPart[]> {
  if (snapshot) {
    const state = validateMiniAppState(snapshot.reactiveState);
    viewState = { ...viewState, ...(Object.hasOwn(state, '__ysExplore') ? { __ysExplore: state.__ysExplore } : {}) };
  }
  const [{ createParser, createLibrary, createStore, evaluateRoot, isReactiveAssign }, { chatLibrary, reportLibrary, presentationLibrary }] = await Promise.all([
    import('@openuidev/lang-core'), import('@openuidev/thesys'),
  ]);
  const svgChatLibrary = createLibrary({ root: chatLibrary.root, components: [...Object.values(chatLibrary.components), ...miniAppDefinitions, ...svgDefinitions, HtmlView], functions: [...miniAppFunctions, ...dashboardFunctions], actions: [askAgentAction] });
  const split = splitReportProgram(program);
  const parts: OpenUiExportPart[] = [];
  const charts: Array<{ part: Extract<OpenUiExportPart, { kind: 'image' }>; name: string; props: Record<string, unknown> }> = [];
  const htmlViews: Array<{ placeholder: OpenUiExportPart; props: Record<string, unknown> }> = [];
  const chartImage = (name: string, props: Record<string, unknown>) => {
    if (!renderChart) return;
    const part = { kind: 'image' as const, source: '', caption: '' };
    parts.push(part);
    charts.push({ part, name, props });
  };
  let chatExploration = false;
  let appName = '';
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
  const walk = (value: unknown, depth = 0, chartRenderer?: { name: string; props: Record<string, unknown> }): void => {
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
    if (name === 'MiniButton') return;
    if (name === 'HtmlView') {
      if (!snapshot?.identity || !renderHtml) throw new Error('Saved mounted HtmlView required for export');
      const placeholder: OpenUiExportPart = { kind: 'markdown', markdown: '' };
      // Plain object bindings use useStateField's scoped form value after edits;
      // the original $variable remains a default in the SDK snapshot.
      const form = snapshot.reactiveState[appName];
      const field = form && typeof form === 'object' && !Array.isArray(form) && typeof props.name === 'string'
        ? (form as Record<string, unknown>)[props.name] : undefined;
      let capturedProps = props;
      if (field !== undefined) {
        if (!field || typeof field !== 'object' || Array.isArray(field) || !('componentType' in field) || field.componentType !== 'HtmlView' || !('value' in field)) throw new Error('Invalid saved HTML field');
        capturedProps = { ...props, value: validateMiniAppState(field.value) };
      }
      parts.push(placeholder); htmlViews.push({ placeholder, props: capturedProps }); return;
    }
    if (name === 'MiniApp') {
      add(`## ${props.title}`); add(String(props.description ?? ''));
      const previous = appName; appName = String(props.name);
      try { walk(props.children, depth + 1); } finally { appName = previous; }
      return;
    }
    if (name === 'MiniTaskResult') {
      const result = snapshot?.taskResults?.[appName];
      if (!result || !props.inputs || typeof props.inputs !== 'object'
        || miniAppStateSignature(validateMiniAppState(props.inputs)) !== miniAppStateSignature(validateMiniAppState(result.inputs))) throw new Error('Saved mini-app result is missing or does not match the saved inputs');
      add(String(props.label)); parts.push(...result.parts); return;
    }
    if (['MiniInput', 'MiniSelect', 'MiniToggle', 'MiniDocument'].includes(name)) {
      const raw = props.value;
      const value = isReactiveAssign(raw) ? snapshot?.reactiveState[raw.target] : raw;
      if (name === 'MiniDocument') {
        const filename = typeof value === 'string' && value ? snapshot?.documents?.[value] : '';
        if (value && !filename) throw new Error('Saved mini-app document requires authorized document resolution');
        add(`${props.label}: ${filename ?? ''}`); return;
      }
      const selected = name === 'MiniSelect' && Array.isArray(props.options)
        ? props.options.find((option: { value?: unknown }) => option.value === value)?.label : undefined;
      add(`${props.label}: ${selected ?? (value == null ? '' : String(value))}`);
      return;
    }
    if (name === 'MiniOutput') { add(`${props.label}: ${props.value != null && typeof props.value === 'object' ? JSON.stringify(props.value) : props.value == null ? '' : String(props.value)}`); return; }
    if (name === 'MiniList') { add(Array.isArray(props.items) && props.items.length ? props.items.map(item => `- ${item}`).join('\n') : String(props.emptyText ?? '')); return; }
    if (name === 'Svg') {
      if (!renderChart) throw new Error('SVG export requires visual capture');
      chartImage(name, props);
      charts[charts.length - 1].part.caption = typeof props.title === 'string' ? props.title : '';
      return;
    }
    if (/ChartV2$/.test(name)) {
      const chartData = props.chartData as { data?: Record<string, unknown> | unknown[]; unit?: string } | undefined;
      const data = chartData?.data;
      walk({ type: 'element', typeName: name === 'BarChartV2' && props.isHorizontal ? 'HorizontalBarChart' : name.replace(/V2$/, ''), props: {
        ...(Array.isArray(data) ? { slices: data } : data), unit: chartData?.unit, xLabel: props.xAxisLabel, yLabel: props.yAxisLabel, variant: props.variant,
      } }, depth + 1, { name, props });
      return;
    }
    if (name === 'Table') {
      if (!Array.isArray(props.columns) || !Array.isArray(props.rows)) throw new Error('Incomplete OpenUI export table');
      const exploration = viewState?.__ysExplore as Record<string, { componentType?: string; value?: unknown }> | undefined;
      const saved = exploration?.[`table:${node.statementId}`];
      const view = saved?.componentType === 'TableView' ? saved.value : undefined;
      const allRows = props.rows as unknown[][];
      const selectedRows = tableView(view).selectedRows;
      const rows = getTableRows(allRows, view).filter(({ index }) => !selectedRows.length || selectedRows.includes(index));
      table(props.columns.map((column) => typeof column === 'string' ? column : (column as { props?: { label?: unknown } })?.props?.label), rows.map(({ row }) => row));
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.labels) && Array.isArray(props.series)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      add(`\`\`\`json\n${JSON.stringify({ chart: name, xLabel: props.xLabel, yLabel: props.yLabel, unit: props.unit, variant: props.variant })}\n\`\`\``);
      const originalSeries = props.series as Array<{ category?: string; values?: unknown[] }>;
      const exploration = viewState?.__ysExplore as Record<string, { componentType?: string; value?: unknown }> | undefined;
      const saved = exploration?.[`chart:${node.statementId}`];
      const supported = chatExploration && ['BarChart', 'HorizontalBarChart', 'LineChart'].includes(name);
      const data = supported ? getChartData(props.labels, originalSeries, saved?.componentType === 'ChartView' ? saved.value : undefined)
        : { labels: props.labels, series: originalSeries };
      chartImage(chartRenderer?.name ?? name, chartRenderer?.props ?? { ...props, labels: data.labels, series: data.series });
      table(['', ...data.series.map((entry) => entry.category ?? '')], data.labels.map((label, index) => [label, ...data.series.map((entry) => entry.values?.[index])]));
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.slices)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      chartImage(chartRenderer?.name ?? name, chartRenderer?.props ?? props);
      add(`\`\`\`json\n${JSON.stringify({ chart: name, unit: props.unit, variant: props.variant })}\n\`\`\``);
      table(['Category', 'Value'], (props.slices as Array<{ category: string; value: number }>).map((slice) => [slice.category, slice.value]));
      return;
    }
    if (/Chart$/.test(name) && Array.isArray(props.datasets)) {
      if (typeof props.heading === 'string') add(`## ${props.heading}`);
      if (typeof props.description === 'string') add(props.description);
      chartImage(chartRenderer?.name ?? name, chartRenderer?.props ?? props);
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
    chatExploration = library === chatLibrary;
    const parsed = createParser((chatExploration ? svgChatLibrary : library).toJSONSchema()).parse(source);
    if ((!parsed.root && !parsed.rootExpression) || parsed.meta.incomplete || parsed.meta.errors.length || parsed.meta.unresolved.length || parsed.queryStatements.length || parsed.mutationStatements.length || (!snapshot && (Object.keys(parsed.stateDeclarations).length || parsed.rootExpression))) throw new Error('Invalid or interactive OpenUI export');
    if (!snapshot || !chatExploration) { walk(parsed.root); continue; }
    const state = validateMiniAppState(snapshot.reactiveState);
    const store = createStore();
    try {
      const bindings = Object.fromEntries(Object.entries(state).filter(([key]) => key.startsWith('$')));
      store.initialize(parsed.stateDeclarations, bindings);
      const schema = svgChatLibrary.toJSONSchema();
      const functions = Object.fromEntries(Object.entries(schema.functions ?? {}).flatMap(([key, definition]) => {
        return [[key, { ...definition, fn: svgChatLibrary.functions[key].fn }]];
      }));
      const errors: import('@openuidev/lang-core').OpenUIError[] = [];
      // Match the installed Renderer: form entries may wrap their typed value.
      const getState = (key: string): unknown => { const value = store.get(key); return value && typeof value === 'object' && 'value' in value ? value.value : value; };
      const root = evaluateRoot(parsed, { library: svgChatLibrary, store: null, errors, ctx: {
        getState,
        resolveRef: () => { throw new Error('Runtime references cannot execute during export'); }, functions,
      } });
      if (!root || errors.length) throw new Error('Unable to evaluate saved OpenUI view');
      let count = 0;
      const materialize = (value: unknown, depth = 0): unknown => {
        if (++count > 20_000 || depth > 60) throw new Error('Saved OpenUI view exceeds export limits');
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid saved OpenUI number');
        if (Array.isArray(value)) return value.map(entry => materialize(entry, depth + 1));
        if (!value || typeof value !== 'object') return value;
        const entry = value as Record<string, unknown>;
        if (entry.type === 'element' && (entry.typeName === 'MiniButton' || (typeof entry.typeName === 'string' && INTERACTIVE.test(entry.typeName)))) return null;
        // Reactive input descriptors remain inert and are resolved only by their saved target.
        if (isReactiveAssign(entry)) return getState(entry.target);
        if ('k' in entry || (entry.type === 'element' && entry.partial)) throw new Error('Unresolved saved OpenUI expression');
        return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, entry.type === 'element' && key === 'hasDynamicProps' ? false : materialize(child, depth + 1)]));
      };
      walk(materialize(root));
    } finally { store.dispose(); }
  }
  // Capture only after the complete saved program has passed validation. Keep
  // captures sequential so their offscreen theme/style scopes cannot race.
  for (const chart of charts) chart.part.source = await renderChart!(chart.name, chart.props);
  for (const view of htmlViews) parts.splice(parts.indexOf(view.placeholder), 1, ...await renderHtml!(view.props));
  return parts;
}

export function exportPartsToMarkdown(parts: readonly OpenUiExportPart[]): string {
  return parts.map((part) => {
    if (part.kind === 'markdown') return part.markdown;
    // Alt text is not visible in HTML/PDF when an image loads. Keep a literal
    // caption immediately beneath its image as well, escaping Markdown syntax
    // so a saved label cannot become an extra link, image or HTML element.
    const caption = part.caption.replace(/[\\`*_[\]{}()#+.!><|~&\-]/g, '\\$&').replace(/\r?\n/g, ' ');
    const image = `![${caption}](${part.source.replaceAll('(', '%28').replaceAll(')', '%29')})`;
    return caption.trim() ? `${image}\n\n${caption}` : image;
  }).join('\n\n');
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
