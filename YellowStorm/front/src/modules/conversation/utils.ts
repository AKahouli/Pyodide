import { z } from 'zod';
import type { ChatMessage } from '@/components/ai-elements/chat-conversation';
import type { CitationBBox, MessageContentPart } from '@/components/ai-elements/ai-message-content';
import type { ModuleTranslationKey } from '@/modules/localization';
import type { ChartComponentData, ChartKind, ChartLayout, ChoiceComponentData, Message, MessageComponent } from './types';
import { translateConversation } from './translation';

export type ConversationStreamActivity = 'thinking' | 'usingTools' | 'responding';

const conversationVisibleComponentTypes = new Set([
  'text',
  'code',
  'queue',
  'plan',
  'checkpoint',
  'chart',
  'task',
  'error',
  'sources',
  'sandbox',
  'webPreview',
  'artifact',
  'agentActivity',
  'toolActivity',
  'citation',
  'choice',
]);

function getComponentType(component: MessageComponent): string {
  return typeof component.type === 'object' && component.type !== null
    ? (component.type as { type?: string }).type || ''
    : component.type;
}

/**
 * Projects structured agent output into the user-facing transcript. Internal
 * Activity remains structured UI content; unrecognised payloads are never chat content.
 */
export function mapConversationComponentsToContentParts(components: MessageComponent[]): MessageContentPart[] {
  return mapComponentsToContentParts(components.filter((component) => conversationVisibleComponentTypes.has(getComponentType(component))));
}

export function getConversationStreamActivity(components: MessageComponent[]): ConversationStreamActivity {
  const componentTypes = components.map(getComponentType);
  if (componentTypes.includes('toolActivity')) return 'usingTools';
  if (componentTypes.some((type) => type === 'text' || type === 'code')) return 'responding';
  return 'thinking';
}

const chartKindSchema = z.enum(['line', 'bar', 'area', 'pie', 'scatter', 'composed']);
const chartLayoutSchema = z.enum(['horizontal', 'vertical']);
const chartSeriesSchema = z.object({
  dataKey: z.string(),
  color: z.string().optional(),
  label: z.string().optional(),
  kind: chartKindSchema.optional(),
});
const chartConfigSchema = z.record(z.object({ label: z.string().optional(), color: z.string().optional() }));
const chartPayloadSchema = z.object({
  title: z.string().optional().catch(''),
  data: z.union([z.string(), z.array(z.record(z.unknown()))]).optional().catch([]),
  chartData: z.union([z.string(), z.array(z.record(z.unknown()))]).catch([]),
  config: z.union([z.string(), chartConfigSchema]).catch({}),
  xAxisKey: z.string().catch(''),
  yAxisKey: z.string().optional().catch(''),
  nameKey: z.string().optional().catch(''),
  zAxisKey: z.string().optional().catch(''),
  series: z.union([z.string(), z.array(chartSeriesSchema)]).catch([]),
  kind: z.union([z.string(), chartKindSchema]).optional().catch('bar'),
  stacked: z.boolean().optional().catch(false),
  layout: z.union([z.string(), chartLayoutSchema]).optional().catch('horizontal'),
  innerRadius: z.number().optional().catch(0),
  showLegend: z.boolean().optional().catch(true),
  showGrid: z.boolean().optional().catch(true),
  error: z.string().optional(),
});

const chartComponentSchema = z.object({
  title: z.string().optional(),
  data: z.array(z.record(z.unknown())),
  config: chartConfigSchema,
  xAxisKey: z.string(),
  yAxisKey: z.string().optional(),
  nameKey: z.string().optional(),
  zAxisKey: z.string().optional(),
  series: z.array(chartSeriesSchema),
  kind: chartKindSchema,
  stacked: z.boolean().optional(),
  layout: chartLayoutSchema.optional(),
  innerRadius: z.number().optional(),
  showLegend: z.boolean().optional(),
  showGrid: z.boolean().optional(),
});

/**
 * Formats milliseconds to a human-readable duration string
 */
export function formatTimingMs(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Builds the readable display text for a user message. Choice answers prefer
 * the canonical per-interaction displayText (readable) over the raw canonical
 * JSON that is persisted as message.content.
 */
export function getUserMessageDisplayText(msg: Message): string {
  if (msg.interactions?.length) {
    const displayTexts = msg.interactions.map((interaction) => interaction.displayText).filter(Boolean);
    return displayTexts.length ? displayTexts.join(', ') : msg.content || '';
  }
  return msg.interaction?.type === 'choice' && msg.interaction.displayText
    ? msg.interaction.displayText
    : msg.content || '';
}

/**
 * Maps a backend Message to the frontend ChatMessage format
 */
export function messageToChat(msg: Message): ChatMessage {
  let content: string | MessageContentPart[];
  if (msg.conversationType === 'user') {
    content = getUserMessageDisplayText(msg);
  } else {
    content = mapConversationComponentsToContentParts(msg.components || []);
  }
  
return {
  id: msg.id,
  role: msg.conversationType === 'user' ? 'user' : 'assistant',
  content,
  timestamp: new Date(msg.createdAt),
  isEdited: msg.isEdited,
};
}

/**
 * Builds a CitationData object from raw component data.
 */
function asCitationBBox(value: unknown): CitationBBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const bbox = value.map((item) => Number(item));
  return bbox.every(Number.isFinite) ? bbox as CitationBBox : undefined;
}

function buildCitationData(data: Record<string, unknown>): {
  parentId: string;
  sourceType: 'text' | 'image';
  source: string;
  fileName?: string;
  externalId: string;
  page: string;
  pageContent: string;
  workspaceId: string;
  reference?: string;
  path?: string;
  height?: string;
  width?: string;
  highlightText?: string;
  highlightBBox?: CitationBBox;
  blockBBox?: CitationBBox;
} {
  const textSource = data.text_source as Record<string, unknown> | undefined;
  const imageSource = data.image_source as Record<string, unknown> | undefined;
  const sourceData = textSource || imageSource || data;
  const sourceType = imageSource ? 'image' : ((sourceData.sourceType as 'text' | 'image') || 'text');

  return {
    parentId: (data.parentId as string) || (data.parent_id as string) || '',
    sourceType,
    source: (sourceData.source as string) || (sourceData.fileName as string) || (sourceData.file_name as string) || '',
    fileName: (sourceData.fileName as string) || (sourceData.file_name as string) || undefined,
    externalId: (sourceData.externalId as string) || (sourceData.external_id as string) || '',
    page: (sourceData.page as string) || '',
    pageContent: (sourceData.highlightText as string) || (sourceData.highlight_text as string) || (sourceData.pageContent as string) || (sourceData.page_content as string) || (sourceData.content as string) || '',
    workspaceId: (sourceData.workspaceId as string) || (sourceData.workspace_id as string) || (sourceData.workspace_name as string) || '',
    reference: (sourceData.reference as string) || undefined,
    path: (sourceData.path as string) || '',
    height: (sourceData.height as string) || '',
    width: (sourceData.width as string) || '',
    highlightText: (sourceData.highlightText as string) || (sourceData.highlight_text as string) || undefined,
    highlightBBox: asCitationBBox(sourceData.highlightBBox ?? sourceData.highlight_bbox),
    blockBBox: asCitationBBox(sourceData.blockBBox ?? sourceData.block_bbox),
  };
}

function findTextPartsByReference(parts: MessageContentPart[], reference?: string): number[] {
  const ref = reference?.trim().replace(/^\[|\]$/g, '').trim();
  if (!ref) {
    return [];
  }

  return parts.flatMap((part, index) => part.type === 'text' && part.content.includes(`[${ref}]`) ? [index] : []);
}

function attachCitation(parts: MessageContentPart[], index: number, citation: ReturnType<typeof buildCitationData>): boolean {
  const part = parts[index];
  if (part?.type !== 'text') {
    return false;
  }
  if (!part.citations) {
    part.citations = [];
  }
  part.citations.push(citation);
  return true;
}

/**
 * Maps a single non-citation component to a MessageContentPart.
 */
function mapSingleComponent(comp: MessageComponent): MessageContentPart {
  const data = comp.data || {};
  // Handle case where type might be nested (MongoDB/Mongoose quirk)
  const compType = typeof comp.type === 'object' && comp.type !== null ? (comp.type as { type?: string }).type || 'text' : comp.type;
  switch (compType) {
    case 'text':
      return { type: 'text', content: (data.content as string) || '' };
    case 'code':
      return {
        type: 'code',
        content: (data.content as string) || '',
        language: (data.language as string) || '',
        filename: (data.filename as string) || undefined,
      };
    case 'agentActivity':
      return {
        type: 'agentActivity',
        summary: (data.summary as string) || '',
        status: (data.status as 'running' | 'completed') || 'running',
        startedAt: (data.startedAt as string) || undefined,
        completedAt: (data.completedAt as string) || undefined,
        durationMs: data.durationMs != null ? Number(data.durationMs) : undefined,
        actorId: (data.actorId as string) || undefined,
        actorName: (data.actorName as string) || undefined,
      };
    case 'plan':
      return {
        type: 'plan',
        title: (data.title as string) || '',
        description: (data.description as string) || '',
        steps: (data.steps as Array<{ task: string; agent: string; status: 'pending' | 'in_progress' | 'completed' | 'error' }>) || [],
        status: (data.status as 'pending' | 'in_progress' | 'completed' | 'error') || undefined,
      };
    case 'queue':
      return {
        type: 'queue',
        title: (data.title as string) || '',
        items: (data.items as Array<{ id: string; title: string; status: 'pending' | 'completed' | 'active' }>) || [],
      };
    case 'checkpoint':
      return {
        type: 'checkpoint',
        label: (data.label as string) || (data.content as string) || '',
      };
    case 'chart':
      return mapChartComponent(data);
    case 'choice': {
      const choice = normalizeChoiceComponentData(data);
      return choice ? { type: 'choice', componentId: comp.id || '', ...choice } : { type: 'text', content: (data.fallbackText as string) || '' };
    }
    case 'task':
      return {
        type: 'task',
        title: (data.title as string) || '',
        items: (data.items as string[]) || [],
        status: (data.status as 'pending' | 'in_progress' | 'completed') || undefined,
      };
    case 'error':
      return {
        type: 'error',
        title: (data.title as string) || (data.code as string) || '',
        content: (data.content as string) || (data.message as string) || '',
      };
    case 'sources':
      return {
        type: 'sources',
        sources: (data.sources as Array<{ title: string; url: string }>) || [],
      };
    case 'sandbox':
      return {
        type: 'sandbox',
        code: (data.code as string) || '',
        output: (data.output as string) || '',
        error: (data.error as string) || '',
        outputAvailable: data.outputAvailable === true || data.output_available === true,
      };
    case 'webPreview':
      return {
        type: 'webPreview',
        content: (data.content as string) || '',
      };
    case 'artifact':
      return {
        type: 'artifact',
        filePath: '',
        filename: (data.filename as string) || '',
      };
    case 'toolActivity':
      return {
        type: 'toolActivity',
        toolName: (data.toolName as string) || '',
        summary: (data.summary as string) || '',
        renderKind: (data.renderKind as import('./types').ToolRenderKind) || 'generic',
        status: (data.status as 'running' | 'completed' | 'failed' | 'stopped') || 'running',
        displayKey: (data.displayKey as string) || undefined,
        fallbackDisplayName: (data.fallbackDisplayName as string) || undefined,
        paramsJson: (data.paramsJson as string) || undefined,
        resultJson: (data.resultJson as string) || undefined,
        startedAt: (data.startedAt as string) || undefined,
        completedAt: (data.completedAt as string) || undefined,
        durationMs: data.durationMs != null ? Number(data.durationMs) : undefined,
        actorId: (data.actorId as string) || undefined,
        actorName: (data.actorName as string) || undefined,
        primaryInput: (data.primaryInput as string) || undefined,
        primaryInputLanguage: (data.primaryInputLanguage as string) || undefined,
      };
    default:
      return { type: 'text', content: (data.content as string) || '' };
  }
}

/**
 * Maps backend MessageComponent[] to frontend MessageContentPart[]
 *
 * Uses a two-pass approach:
 * 1. Map all non-citation components to parts, tracking component ID → part index
 * 2. Process citation components, attaching them to parent text parts or rendering standalone
 */
export function mapComponentsToContentParts(components: MessageComponent[]): MessageContentPart[] {
  if (!components || !Array.isArray(components)) {
    return [];
  }

  const validComps = components.filter((comp) => comp && comp.type);

  // Separate citations from other components
  const regularComps: MessageComponent[] = [];
  const citationComps: MessageComponent[] = [];
  for (const comp of validComps) {
    const compType = getComponentType(comp) || 'text';
    if (compType === 'citation') {
      citationComps.push(comp);
    } else {
      regularComps.push(comp);
    }
  }

  // Pass 1: Map regular components, track component ID → part index
  const idToIndex = new Map<string, number>();
  const parts: MessageContentPart[] = regularComps.map((comp, idx) => {
    // Track component id for citation parent matching
    if ((comp as any).id) {
      idToIndex.set((comp as any).id, idx);
    }
    return mapSingleComponent(comp);
  });

  // Pass 2: Attach citations to parent text parts
  for (const comp of citationComps) {
    const data = comp.data || {};
    const parentId = data.parentId as string;
    const citation = buildCitationData(data);
    const attachedIndices = new Set<number>();

    if (parentId && idToIndex.has(parentId)) {
      const parentIndex = idToIndex.get(parentId)!;
      if (attachCitation(parts, parentIndex, citation)) {
        attachedIndices.add(parentIndex);
      }
    }

    for (const referenceMatchIndex of findTextPartsByReference(parts, citation.reference)) {
      if (!attachedIndices.has(referenceMatchIndex) && attachCitation(parts, referenceMatchIndex, citation)) {
        attachedIndices.add(referenceMatchIndex);
      }
    }

    if (attachedIndices.size > 0) {
      continue;
    }
    // Fallback: standalone citation part
    parts.push({ type: 'citation', ...citation });
  }

  return parts;
}

function parseChartData(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return (value as T) ?? fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonArrayValue<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeChartKind(kind: unknown): 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed' {
  if (typeof kind === 'number') {
    const numericKindMap: Record<number, 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed'> = {
      1: 'bar',
      2: 'line',
      3: 'area',
      4: 'pie',
      5: 'scatter',
      6: 'composed',
    };
    return numericKindMap[kind] || 'bar';
  }

  const normalized = typeof kind === 'string'
    ? kind.toLowerCase().replace('chart_kind_', '').replace('chartkind_', '')
    : '';

  if (normalized === 'unspecified' || normalized === '') return 'bar';
  if (normalized === 'chart_kind_unspecified') return 'bar';

  return chartKindSchema.catch('bar').parse(normalized || 'bar');
}

function normalizeChartLayout(layout: unknown): 'horizontal' | 'vertical' {
  if (typeof layout === 'number') {
    const numericLayoutMap: Record<number, 'horizontal' | 'vertical'> = {
      1: 'horizontal',
      2: 'vertical',
    };
    return numericLayoutMap[layout] || 'horizontal';
  }

  const normalized = typeof layout === 'string'
    ? layout.toLowerCase().replace('chart_layout_', '').replace('chartlayout_', '')
    : '';
  if (normalized === 'unspecified' || normalized === '') return 'horizontal';
  if (normalized === 'chart_layout_unspecified') return 'horizontal';
  return chartLayoutSchema.catch('horizontal').parse(normalized || 'horizontal');
}

function mapChartComponent(data: Record<string, unknown>) {
  const parsed = chartPayloadSchema.safeParse(data);
  if (!parsed.success) {
    return {
      type: 'error' as const,
      title: '',
      content: 'ai.chart.errorContent',
    };
  }

  const payload = parsed.data;

  if (payload.error) {
    return {
      type: 'error' as const,
      title: payload.title || '',
      content: 'ai.chart.errorContent',
    };
  }

  const chartData = parseChartData(payload.data ?? payload.chartData);
  const config = parseJsonValue<Record<string, { label?: string; color?: string }>>(payload.config, {});
  const series = parseJsonArrayValue<{ dataKey: string; color?: string; label?: string; kind?: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed' }>(payload.series);
  const normalizedKind = normalizeChartKind(payload.kind);
  const normalizedLayout = normalizeChartLayout(payload.layout);

  return {
    type: 'chart' as const,
    title: payload.title || '',
    data: chartData,
    config,
    xAxisKey: payload.xAxisKey || '',
    yAxisKey: payload.yAxisKey || '',
    nameKey: payload.nameKey || '',
    zAxisKey: payload.zAxisKey || '',
    series,
    kind: normalizedKind,
    stacked: payload.stacked,
    layout: normalizedLayout,
    innerRadius: payload.innerRadius,
    showLegend: payload.showLegend,
    showGrid: payload.showGrid,
  };
}

export function normalizeChartComponentData(data: unknown): ChartComponentData | null {
  if (!data || typeof data !== 'object') return null;

  const result = chartComponentSchema.safeParse(data);
  if (result.success) return result.data;

  const mapped = mapChartComponent(data as Record<string, unknown>);
  if (mapped.type !== 'chart') return null;

  return {
    title: mapped.title,
    data: mapped.data,
    config: mapped.config,
    xAxisKey: mapped.xAxisKey,
    yAxisKey: mapped.yAxisKey,
    nameKey: mapped.nameKey,
    zAxisKey: mapped.zAxisKey,
    series: mapped.series,
    kind: mapped.kind,
    stacked: mapped.stacked,
    layout: mapped.layout,
    innerRadius: mapped.innerRadius,
    showLegend: mapped.showLegend,
    showGrid: mapped.showGrid,
  };
}

export function normalizeChoiceComponentData(data: unknown): ChoiceComponentData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  const options = Array.isArray(raw.options) ? raw.options : [];
  if (raw.schemaVersion !== 1 || typeof raw.questionId !== 'string' || !raw.questionId || typeof raw.prompt !== 'string' || !raw.prompt || options.length < 2 || options.length > 10) return null;
  const ids = new Set<string>();
  const normalizedOptions = options.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const option = item as Record<string, unknown>;
    if (typeof option.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(option.id) || ids.has(option.id) || typeof option.label !== 'string' || !option.label || typeof option.submitText !== 'string' || !option.submitText) return null;
    ids.add(option.id);
    const url = typeof option.url === 'string' && /^https:\/\//i.test(option.url) ? option.url : undefined;
    return { id: option.id, label: option.label, submitText: option.submitText, ...(typeof option.value === 'string' ? { value: option.value } : {}), ...(typeof option.description === 'string' ? { description: option.description } : {}), ...(url ? { url } : {}), ...(option.disabled === true ? { disabled: true } : {}) };
  });
  if (normalizedOptions.some((option) => option === null)) return null;
  const presentation = raw.presentation === 'list' ? 'list' : 'quick_replies';
  const selectionMode = raw.selectionMode === 'multiple' ? 'multiple' : 'single';
  const other = raw.otherOption;
  const otherOption = other && typeof other === 'object' && (other as Record<string, unknown>).enabled === true && typeof (other as Record<string, unknown>).label === 'string'
    ? { enabled: true, label: (other as Record<string, unknown>).label as string, ...(typeof (other as Record<string, unknown>).placeholder === 'string' ? { placeholder: (other as Record<string, unknown>).placeholder as string } : {}), maxLength: typeof (other as Record<string, unknown>).maxLength === 'number' ? (other as Record<string, unknown>).maxLength as number : 500 }
    : undefined;
  const labels = raw.labels && typeof raw.labels === 'object' ? raw.labels as ChoiceComponentData['labels'] : undefined;
  const progress = raw.progress && typeof raw.progress === 'object' && typeof (raw.progress as Record<string, unknown>).current === 'number' && typeof (raw.progress as Record<string, unknown>).total === 'number' ? raw.progress as ChoiceComponentData['progress'] : undefined;
  // Edit-on-card: keep editable draft fields so the renderer can show inputs.
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter((f) => typeof f.key === 'string' && typeof f.label === 'string')
    .map((f) => ({ key: f.key as string, label: f.label as string, value: typeof f.value === 'string' ? f.value : '', ...(f.multiline === true ? { multiline: true } : {}), ...(f.type === 'list' || f.type === 'text' ? { type: f.type as 'list' | 'text' } : {}) }));
  const editable = raw.editable === true && fields.length > 0;
  return { schemaVersion: 1, questionId: raw.questionId, prompt: raw.prompt, ...(typeof raw.description === 'string' ? { description: raw.description } : {}), presentation, selectionMode, submitBehavior: selectionMode === 'multiple' || presentation === 'list' || otherOption || raw.submitBehavior === 'explicit' ? 'explicit' : 'immediate', options: normalizedOptions as ChoiceComponentData['options'], ...(otherOption ? { otherOption } : {}), ...(labels ? { labels } : {}), ...(progress ? { progress } : {}), ...(typeof raw.fallbackText === 'string' ? { fallbackText: raw.fallbackText } : {}), dismissible: raw.dismissible === true, status: raw.status === 'submitted' || raw.status === 'disabled' ? raw.status : 'ready', ...(editable ? { editable: true, fields } : {}) };
}

/**
 * Converts message components to markdown for copy-to-clipboard
 */
export function componentsToMarkdown(components: MessageComponent[]): string {
  if (!components || !Array.isArray(components)) {
    return '';
  }
  const fallbackErrorTitle = translateConversation('messageActions.markdown.errorFallback');
  const outputLabel = translateConversation('messageActions.markdown.outputLabel');
  const errorLabel = translateConversation('messageActions.markdown.errorLabel');
  const defaultCitationSource = translateConversation('messageActions.markdown.defaultCitation');
  return components
    .filter((comp) => comp && conversationVisibleComponentTypes.has(getComponentType(comp)))
    .map((comp) => {
      const data = comp.data || {};
      switch (comp.type) {
        case 'text':
          return (data.content as string) || '';
        case 'code': {
          const lang = (data.language as string) || '';
          const content = (data.content as string) || '';
          return `\`\`\`${lang}\n${content}\n\`\`\``;
        }
        case 'plan': {
          const title = (data.title as string) || '';
          const steps = (data.steps as string[]) || [];
          return `**${title}**\n${steps.map((s) => `- ${s}`).join('\n')}`;
        }
        case 'checkpoint':
          return `---\n**${(data.content as string) || ''}**`;
        case 'error': {
          const errTitle = (data.title as string) || fallbackErrorTitle;
          const errContent = (data.content as string) || '';
          return `> **${errTitle}**: ${errContent}`;
        }
        case 'sandbox': {
          const code = (data.code as string) || '';
          const output = (data.output as string) || '';
          const error = (data.error as string) || '';
          let result = `\`\`\`python\n${code}\n\`\`\``;
          if (output) result += `\n\n${outputLabel}\n\`\`\`\n${output}\n\`\`\``;
          if (error) result += `\n\n${errorLabel}\n\`\`\`\n${error}\n\`\`\``;
          return result;
        }
        case 'webPreview': {
          const content = (data.content as string) || '';
          return `\`\`\`html\n${content}\n\`\`\``;
        }
        case 'artifact': {
          const filename = (data.filename as string) || 'file';
          return `📎 [${filename}]`;
        }
        case 'citation': {
          const reference = (data.reference as string) || '';
          const source = (data.source as string) || (data.fileName as string) || defaultCitationSource;
          const displayLabel = reference || source;
          const page = (data.page as string) || '';
          return page ? `[${displayLabel}, p.${page}]` : `[${displayLabel}]`;
        }
        default:
          return (data.content as string) || '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

// ===== Error Handling =====

interface StreamErrorInfo {
  title: string;
  description: string;
  isCritical: boolean;
}

interface StreamErrorDefinition {
  titleKey: ModuleTranslationKey<'conversation'>;
  descriptionKey: ModuleTranslationKey<'conversation'>;
  isCritical: boolean;
}

const STREAM_ERROR_DEFINITIONS: Record<string, StreamErrorDefinition> = {
  ERR_1417: {
    titleKey: 'streamErrors.ERR_1417.title',
    descriptionKey: 'streamErrors.ERR_1417.description',
    isCritical: true,
  },
  ERR_1406: {
    titleKey: 'streamErrors.ERR_1406.title',
    descriptionKey: 'streamErrors.ERR_1406.description',
    isCritical: true,
  },
  ERR_1407: {
    titleKey: 'streamErrors.ERR_1407.title',
    descriptionKey: 'streamErrors.ERR_1407.description',
    isCritical: true,
  },
  ERR_1405: {
    titleKey: 'streamErrors.ERR_1405.title',
    descriptionKey: 'streamErrors.ERR_1405.description',
    isCritical: true,
  },
  ERR_1409: {
    titleKey: 'streamErrors.ERR_1409.title',
    descriptionKey: 'streamErrors.ERR_1409.description',
    isCritical: false,
  },
  ERR_1410: {
    titleKey: 'streamErrors.ERR_1410.title',
    descriptionKey: 'streamErrors.ERR_1410.description',
    isCritical: false,
  },
};

const STREAM_ERROR_FALLBACK: StreamErrorDefinition = {
  titleKey: 'streamErrors.fallback.title',
  descriptionKey: 'streamErrors.fallback.description',
  isCritical: false,
};

/**
 * Get user-friendly error info for a stream error code
 */
export function getStreamErrorMessage(errorCode: string): StreamErrorInfo {
  const definition = STREAM_ERROR_DEFINITIONS[errorCode] ?? STREAM_ERROR_FALLBACK;
  return {
    title: translateConversation(definition.titleKey),
    description: translateConversation(definition.descriptionKey),
    isCritical: definition.isCritical,
  };
}
