import type { Message, MessageComponent } from '../types';
import { componentToMarkdown, componentsToMarkdown, isVisualConversationComponent } from '../utils';
import { createOpenUiTextProjector, exportPartsToMarkdown, isOpenUiProgram, projectOpenUiProgram, type OpenUiExportPart } from '../components/openui/plain-text';
import { fetchConversationFiles, fetchMessage, fetchOpenUiAppState } from '../api';
import { assertMiniAppExportReady, miniAppStateSignature, validateMiniAppSnapshot } from '../components/openui/mini-app-state';
import type { OpenUiReactiveExportSnapshot } from '../components/openui/plain-text';
import { translateConversation } from '../translation';

/** Local downloads never modify the transcript. The explicit agent export action
 * sends only projected visible parts through the existing authorized MCP flow. */
async function reactiveExportState(message: Message, component: MessageComponent, actorId?: string, messages: readonly Message[] = []): Promise<OpenUiReactiveExportSnapshot | undefined> {
  const program = String(component.data?.content);
  if (!/\bMiniApp\s*\(/.test(program)) return undefined;
  if (!actorId || !component.id || !message.isComplete || message.isStreaming) throw new Error('Saved private dashboard required');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(program));
  const programDigest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const identity = { userId: actorId, conversationId: message.conversationId, messageId: message.id, componentId: component.id, programDigest };
  await assertMiniAppExportReady(identity);
  const snapshot = validateMiniAppSnapshot(await fetchOpenUiAppState(identity), programDigest);
  if (snapshot.canWrite === false) throw new Error('Private dashboard access required');
  await assertMiniAppExportReady(identity, snapshot);
  const ownSubmissions = messages.filter(task => task.senderId === actorId && (task.interaction?.type !== 'openui'
    || !task.interaction.appTask || task.interaction.appTask.programDigest === programDigest));
  const result: OpenUiReactiveExportSnapshot = { identity, stateRevision: snapshot.stateRevision, reactiveState: snapshot.stateRevision === 0 ? savedViewState(message, component.id, ownSubmissions) : snapshot.state };
  if (/\bMiniDocument\s*\(/.test(program)) {
    result.documents = {};
    for (let page = 1; page <= 100; page++) {
      const files = await fetchConversationFiles(message.conversationId, { page, limit: 50 });
      for (const file of files.documents) if (file.status === 'completed' && !file.isFolder) result.documents[file.id] = file.originalName || file.filename;
      if (page >= files.pagination.totalPages) break;
      if (page === 100) throw new Error('Document export pagination limit');
    }
  }
  if (/\bMiniTaskResult\s*\(/.test(program)) {
    result.taskResults = {};
    const tasks = messages.filter(task => task.conversationId === message.conversationId && task.conversationType === 'user'
      && task.senderId === actorId && task.interaction?.type === 'openui' && task.interaction.sourceMessageId === message.id
      && task.interaction.componentId === component.id && task.interaction.appTask?.programDigest === programDigest)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Latest task per form wins, including failed/stale tasks: never fall back to
    // an older successful result that the displayed app would no longer show.
    const latest = new Map(tasks.map(task => [task.interaction?.type === 'openui' ? task.interaction.formName : '', task]));
    for (const [formName, task] of latest) {
      const interaction = task.interaction;
      if (!formName || interaction?.type !== 'openui' || interaction.appTask?.stateRevision !== snapshot.stateRevision || !task.answerMessageId) continue;
      const answer = await fetchMessage(message.conversationId, task.answerMessageId);
      if (answer.conversationId !== message.conversationId || answer.id !== task.answerMessageId || answer.questionMessageId !== task.id
        || !answer.isComplete || answer.isStreaming || ['failed', 'interrupted', 'cancelled'].includes(answer.terminalStatus ?? '')
        || answer.components?.some(part => part.type === 'error')) continue;
      if (answer.components?.some(part => part.type === 'text' && /\bMiniApp\s*\(/.test(String(part.data?.content)))) throw new Error('Nested interactive task result export is unsupported');
      const { resolveOpenUiExportImage } = await import('./openui-export-assets');
      const blocks = await buildStructuredExportBlocks([answer], { user: '', assistant: '' }, undefined, resolveOpenUiExportImage);
      const parts: OpenUiExportPart[] = blocks.flatMap(block => block.parts ?? [{ kind: 'markdown', markdown: block.markdown }]);
      result.taskResults[formName] = { inputs: interaction.params?.inputs as Record<string, unknown> ?? {}, parts };
    }
  }
  return result;
}

async function captureSavedHtml(props: Record<string, unknown>, snapshot: OpenUiReactiveExportSnapshot): Promise<OpenUiExportPart[]> {
  if (!snapshot.identity || typeof props.html !== 'string') throw new Error('Saved HTML identity required');
  const { captureHtmlView } = await import('../components/openui/html-capture');
  const { captureSavedHtmlPng } = await import('./docx-capture');
  await assertMiniAppExportReady(snapshot.identity);
  const captured = await captureHtmlView({ html: props.html, name: typeof props.name === 'string' ? props.name : 'html', value: props.value }, snapshot.identity);
  const image = await captureSavedHtmlPng(captured);
  if (!image) throw new Error('HTML snapshot rendering failed');
  const acknowledged = validateMiniAppSnapshot(await fetchOpenUiAppState(snapshot.identity), snapshot.identity.programDigest);
  await assertMiniAppExportReady(snapshot.identity, acknowledged);
  if (acknowledged.stateRevision !== snapshot.stateRevision || (acknowledged.stateRevision !== 0 && miniAppStateSignature(acknowledged.state) !== miniAppStateSignature(snapshot.reactiveState))) throw new Error('Saved HTML changed during export');
  const doc = new DOMParser().parseFromString(captured.html, 'text/html');
  // Text and tables stay editable; the labelled picture preserves custom layout/SVG/canvas.
  const { domToPlainText } = await import('../components/openui/plain-text');
  const literal = (value: string) => value.replace(/[\\`*_[\]{}()#+.!><|~&-]/g, '\\$&').replace(/\s+/g, ' ').trim();
  const tables = Array.from(doc.querySelectorAll('table')).map(table => {
    const rows = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => literal(cell.textContent ?? '')));
    if (!rows.length) return '';
    const columns = Math.max(...rows.map(row => row.length));
    const line = (row: string[]) => `| ${Array.from({ length: columns }, (_, index) => row[index] ?? '').join(' | ')} |`;
    return [line(rows[0]), line(Array(columns).fill('---')), ...rows.slice(1).map(line)].join('\n');
  });
  doc.querySelectorAll('table').forEach(table => table.remove());
  const text = [literal(domToPlainText(doc.body)), ...tables].filter(Boolean).join('\n\n');
  const title = typeof props.title === 'string' ? props.title : 'HTML';
  return [{ kind: 'markdown', markdown: text }, { kind: 'image', source: image.dataUrl, caption: `${title} — ${translateConversation('openui.html.snapshot')}` }];
}

async function captureExportVisual(name: string, props: Record<string, unknown>): Promise<string> {
  const { captureOpenUiChartPng, captureOpenUiSvgPng } = await import('./docx-capture');
  const image = await (name === 'Svg' ? captureOpenUiSvgPng(props) : captureOpenUiChartPng(name, props));
  if (!image) throw new Error('OpenUI chart capture failed');
  return image.dataUrl;
}

/** One conversational turn in an exported document. */
export interface ExportBlock {
  role: 'user' | 'ai';
  label: string;
  timestamp?: string;
  markdown: string;
  /** Answer components; exports that render visuals (charts, HTML previews) walk these in order. */
  components?: MessageComponent[];
  parts?: OpenUiExportPart[];
}

export type ExportImageResolver = (source: string, component: MessageComponent, message: Message) => Promise<string>;

/** Ephemeral instructions for the existing MCP export flow. Persistent selectors
 * are preserved exactly; the authorized agent resolves them before execution. */
export async function buildMcpExportManifest(message: Message, submissionMessages: readonly Message[] = [], actorId?: string): Promise<{ parts: Array<OpenUiExportPart & { componentId?: string }> }> {
  const parts: Array<OpenUiExportPart & { componentId?: string }> = [];
  if (message.conversationType === 'user') {
    if (message.content?.trim()) parts.push({ kind: 'markdown', markdown: message.content });
    return { parts };
  }
  for (const component of message.components ?? []) {
    if (component.data?.assetDeletedAt) continue;
    if (!component.data?.assetDeletedAt && component.type === 'text' && isOpenUiProgram(component.data?.content)) {
      const reactive = await reactiveExportState(message, component, actorId, submissionMessages);
      parts.push(...(await projectOpenUiProgram(String(component.data?.content), reactive ? {} : savedViewState(message, component.id, submissionMessages), reactive ? captureExportVisual : undefined, reactive, reactive ? props => captureSavedHtml(props, reactive) : undefined)).map((part) => ({ ...part, componentId: component.id })));
    } else {
      if (isVisualConversationComponent(component)) throw new Error('Legacy visual MCP export is unsupported');
      const markdown = componentToMarkdown(component);
      if (markdown.trim()) parts.push({ kind: 'markdown', markdown, componentId: component.id });
    }
  }
  return { parts };
}

/** Accepted submissions survive reload; optimistic or foreign-scope values never affect exports. */
function savedViewState(source: Message, componentId: string | undefined, messages: readonly Message[]): Record<string, unknown> {
  if (!componentId) return {};
  return messages.filter((message) => message.conversationType === 'user' && !message.id.startsWith('temp-')
    && message.conversationId === source.conversationId && message.interaction?.type === 'openui'
    && message.interaction.sourceMessageId === source.id && message.interaction.componentId === componentId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .reduce<Record<string, unknown>>((state, message) => message.interaction?.type === 'openui'
      ? { ...state, ...message.interaction.formState } : state, {});
}

/** Export only saved content. Resolving assets here makes every format use the
 * same validated image and prevents temporary UI URLs leaking into saved files. */
export async function buildStructuredExportBlocks(
  messages: Message[],
  labels: { user: string; assistant: string },
  formatTimestamp?: (iso: string) => string,
  resolveImage?: ExportImageResolver,
  submissionMessages: readonly Message[] = messages,
  actorId?: string,
  selectedBranches?: ReadonlyMap<string, string>,
): Promise<ExportBlock[]> {
  // Choose the saved branch before parsing/resolving it. An obsolete answer's
  // deleted image must not prevent exporting the replacement answer.
  const questionIds = new Set(messages.filter((message) => message.conversationType === 'user' && message.content?.trim()).map((message) => message.id));
  const selected = new Map<string, { index: number; time: number }>();
  for (const [questionId, answerId] of selectedBranches ?? []) {
    if (questionIds.has(questionId) && !messages.some(message => message.id === answerId && message.questionMessageId === questionId && message.conversationType === 'ai')) throw new Error('Selected saved answer is unavailable');
  }
  messages.forEach((message, index) => {
    if (message.conversationType !== 'ai' || !message.questionMessageId || !questionIds.has(message.questionMessageId)) return;
    const preferred = selectedBranches?.get(message.questionMessageId);
    if (preferred && preferred !== message.id) return;
    const components = message.components ?? [];
    if (!components.some((component) => component.data?.assetDeletedAt || isVisualConversationComponent(component)
      || (!component.data?.assetDeletedAt && component.type === 'text' && isOpenUiProgram(component.data?.content))
      || componentToMarkdown(component).trim())) return;
    const parsedTime = Date.parse(message.createdAt);
    const time = Number.isNaN(parsedTime) ? Number.NEGATIVE_INFINITY : parsedTime;
    const existing = selected.get(message.questionMessageId);
    if (!existing || time >= existing.time) selected.set(message.questionMessageId, { index, time });
  });
  const selectedMessages = messages.filter((message, index) => message.conversationType !== 'ai'
    || !message.questionMessageId || !questionIds.has(message.questionMessageId)
    || selected.get(message.questionMessageId)?.index === index);
  const projected = await Promise.all(selectedMessages.map(async (message) => {
    if (message.conversationType !== 'ai' || !message.components?.some((component) => !component.data?.assetDeletedAt && component.type === 'text' && isOpenUiProgram(component.data?.content))) return { message, parts: undefined };
    const parts: OpenUiExportPart[] = [];
    const components: MessageComponent[] = [];
    for (const component of message.components ?? []) {
      if (component.data?.assetDeletedAt) continue;
      if (!component.data?.assetDeletedAt && component.type === 'text' && isOpenUiProgram(component.data?.content)) {
        const reactive = await reactiveExportState(message, component, actorId, submissionMessages);
        const chartImages = new Set<string>(Object.values(reactive?.taskResults ?? {}).flatMap(result => result.parts.flatMap(part => part.kind === 'image' ? [part.source] : [])));
        const projectedParts = await projectOpenUiProgram(String(component.data?.content), reactive ? {} : savedViewState(message, component.id, submissionMessages), async (name, props) => {
          const source = await captureExportVisual(name, props);
          chartImages.add(source);
          return source;
        }, reactive, reactive ? async props => {
          const captured = await captureSavedHtml(props, reactive);
          for (const part of captured) if (part.kind === 'image') chartImages.add(part.source);
          return captured;
        } : undefined);
        for (const part of projectedParts) {
          if (part.kind !== 'image') { parts.push(part); continue; }
          if (!chartImages.has(part.source) && !resolveImage) throw new Error('OpenUI export image resolver required');
          const source = chartImages.has(part.source) ? part.source : await resolveImage!(part.source, component, message);
          if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) throw new Error('Invalid resolved OpenUI export image');
          parts.push({ ...part, source });
        }
        components.push({ ...component, data: { ...component.data, content: exportPartsToMarkdown(projectedParts) } });
      } else {
        if (isVisualConversationComponent(component)) throw new Error('Mixed OpenUI and legacy visual export is unsupported');
        const markdown = componentToMarkdown(component);
        if (markdown.trim()) parts.push({ kind: 'markdown', markdown });
        components.push(component);
      }
    }
    return { message: { ...message, components }, parts };
  }));
  const blocks = buildExportBlocks(projected.map((entry) => entry.message), labels, formatTimestamp);
  // Blocks retain the exact component array of their selected answer, including
  // newest-answer branch selection performed by buildExportBlocks.
  for (const block of blocks) {
    const owner = projected.find((entry) => entry.message.components === block.components);
    if (owner?.parts) { block.parts = owner.parts; block.markdown = exportPartsToMarkdown(owner.parts); }
  }
  return blocks;
}

const EXPORT_PAGE_LIMIT = 100;
const EXPORT_MAX_PAGES = 100;

function sanitizeFilename(title: string): string {
  const cleaned = title.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').slice(0, 80);
  return cleaned || 'conversation';
}

export function buildExportFilename(title: string, extension: 'docx' | 'pdf' | 'html' | 'pptx'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilename(title)}-${date}.${extension}`;
}

/**
 * Fetch every message of a conversation for export. The store only holds the
 * currently loaded window, so export follows cursor pagination server-side
 * (backend caps `limit` at 100) instead of exporting a partial transcript.
 * The cursor API pages newest-first, so pages are collected then re-sorted
 * chronologically (stable for equal timestamps).
 */
export async function fetchAllMessagesForExport(
  conversationId: string,
  fetchPage: (id: string, params: { mode: 'cursor'; limit: number; cursor?: string }) => Promise<{ items: Message[]; hasMore?: boolean; nextCursor?: string | null }>,
): Promise<Message[]> {
  const collected: Message[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
    const result = await fetchPage(conversationId, { mode: 'cursor', limit: EXPORT_PAGE_LIMIT, cursor });
    collected.push(...result.items);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return collected
    .map((message, index) => ({ message, index, time: Date.parse(message.createdAt) }))
    .sort((left, right) => {
      const leftTime = Number.isNaN(left.time) ? Number.NEGATIVE_INFINITY : left.time;
      const rightTime = Number.isNaN(right.time) ? Number.NEGATIVE_INFINITY : right.time;
      return leftTime - rightTime || left.index - right.index;
    })
    .map((entry) => entry.message);
}

interface SortedTurn {
  time: number;
  seq: number;
  block: ExportBlock;
}

/**
 * Turn a list of messages into export blocks. Only turns with visible content
 * are kept: user prompts use their text, answers their markdown rendering.
 * When `formatTimestamp` is given, block timestamps are display-formatted;
 * otherwise the raw ISO string is kept.
 *
 * Each answer is exported immediately after its question (via
 * `questionMessageId`) rather than by raw timestamps — persisted answers can
 * carry a `createdAt` equal to or earlier than their prompt's, which would
 * otherwise render the answer before the prompt in the exported document.
 * Regenerated branches collapse to the newest answer per question.
 */
export function buildExportBlocks(
  messages: Message[],
  labels: { user: string; assistant: string },
  formatTimestamp?: (iso: string) => string,
): ExportBlock[] {
  const stamp = (iso: string) => formatTimestamp?.(iso) ?? iso;
  const timeOf = (iso: string) => {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };

  // Pass 1 — prompts in chronological order.
  const turns: SortedTurn[] = [];
  const turnIds: string[] = [];
  const questionIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.conversationType !== 'user') return;
    const content = message.content?.trim();
    if (!content) return;
    turns.push({ time: timeOf(message.createdAt), seq: index, block: { role: 'user', label: labels.user, timestamp: stamp(message.createdAt), markdown: content } });
    turnIds.push(message.id);
    questionIds.add(message.id);
  });

  // Pass 2 — attach answers to their question; keep the newest per question.
  const answersByQuestion = new Map<string, SortedTurn>();
  const looseAnswers: SortedTurn[] = [];
  messages.forEach((message, index) => {
    if (message.conversationType !== 'ai') return;
    const components = message.components || [];
    const markdown = componentsToMarkdown(components, createOpenUiTextProjector(message.id, components));
    // Chart/HTML-preview-only answers have no markdown but must still be exported.
    if (!markdown.trim() && !components.some(isVisualConversationComponent)) return;
    const turn: SortedTurn = { time: timeOf(message.createdAt), seq: index, block: { role: 'ai', label: labels.assistant, timestamp: stamp(message.createdAt), markdown, components } };
    const questionId = message.questionMessageId;
    if (questionId && questionIds.has(questionId)) {
      const existing = answersByQuestion.get(questionId);
      if (!existing || turn.time >= existing.time) answersByQuestion.set(questionId, turn);
    } else {
      looseAnswers.push(turn);
    }
  });

  // Interleave: prompt → its answer; unpaired answers slot in by time.
  const loose = looseAnswers.sort((left, right) => left.time - right.time || left.seq - right.seq);
  const result: ExportBlock[] = [];
  turns.forEach((turn, index) => {
    while (loose.length && loose[0].time < turn.time) result.push(loose.shift()!.block);
    result.push(turn.block);
    const answer = answersByQuestion.get(turnIds[index]);
    if (answer) result.push(answer.block);
  });
  while (loose.length) result.push(loose.shift()!.block);
  return result;
}
