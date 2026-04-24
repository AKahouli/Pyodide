import { z } from 'zod';
import type { ChatMessage } from '@/components/ai-elements/chat-conversation';
import type { MessageContentPart } from '@/components/ai-elements/ai-message-content';
import type { ModuleTranslationKey } from '@/modules/localization';
import type { ChartComponentData, ChartKind, ChartLayout, Message, MessageComponent } from './types';
import { translateConversation } from './translation';

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
 * Maps a backend Message to the frontend ChatMessage format
 */
export function messageToChat(msg: Message): ChatMessage {
  let content: string | MessageContentPart[];
  if (msg.conversationType === 'user') {
    content = msg.content || '';
  } else {
    content = mapComponentsToContentParts(msg.components || []);
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
function buildCitationData(data: Record<string, unknown>): {
  parentId: string;
  sourceType: 'text' | 'image';
  source: string;
  externalId: string;
  page: string;
  pageContent: string;
  workspaceId: string;
  reference?: string;
  path?: string;
  height?: string;
  width?: string;
} {
  return {
    parentId: (data.parentId as string) || '',
    sourceType: (data.sourceType as 'text' | 'image') || 'text',
    source: (data.source as string) || (data.fileName as string) || '',
    externalId: (data.externalId as string) || '',
    page: (data.page as string) || '',
    pageContent: (data.pageContent as string) || '',
    workspaceId: (data.workspaceId as string) || '',
    reference: (data.reference as string) || undefined,
    path: (data.path as string) || '',
    height: (data.height as string) || '',
    width: (data.width as string) || '',
  };
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
    case 'reasoning':
      return {
        type: 'reasoning',
        content: (data.content as string) || '',
        duration: data.duration != null ? (data.duration as number) : undefined,
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
      console.debug('[mapSingleComponent] chart component:', { data, dataKeys: Object.keys(data) });
      return mapChartComponent(data);
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
        title: (data.title as string) || '',
        content: (data.content as string) || '',
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
        outputAvailable: data.outputAvailable === true,
      };
    case 'webPreview':
      return {
        type: 'webPreview',
        content: (data.content as string) || '',
      };
    case 'artifact':
      return {
        type: 'artifact',
        filePath: (data.filePath as string) || '',
        filename: (data.filename as string) || '',
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
    const compType = typeof comp.type === 'object' && comp.type !== null ? (comp.type as { type?: string }).type || 'text' : comp.type;
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

    if (parentId && idToIndex.has(parentId)) {
      const parentIdx = idToIndex.get(parentId)!;
      const parentPart = parts[parentIdx];
      if (parentPart.type === 'text') {
        if (!parentPart.citations) parentPart.citations = [];
        parentPart.citations.push(citation);
        continue;
      }
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

  const normalized = typeof kind === 'string' ? kind.toLowerCase().replace('chart_kind_', '') : '';
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

  const normalized = typeof layout === 'string' ? layout.toLowerCase().replace('chart_layout_', '') : '';
  return chartLayoutSchema.catch('horizontal').parse(normalized || 'horizontal');
}

function mapChartComponent(data: Record<string, unknown>) {
  console.debug('[mapChartComponent] Input data:', {
    hasData: 'data' in data,
    hasChartData: 'chartData' in data,
    dataValue: data.data,
    chartDataValue: data.chartData,
    keys: Object.keys(data),
  });

  const parsed = chartPayloadSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[mapChartComponent] Schema validation failed:', parsed.error);
    return {
      type: 'error' as const,
      title: '',
      content: 'ai.chart.errorContent',
    };
  }

  const payload = parsed.data;
  if (payload.error) {
    console.error('[mapChartComponent] Payload has error:', payload.error);
    return {
      type: 'error' as const,
      title: payload.title || '',
      content: 'ai.chart.errorContent',
    };
  }

  const chartData = parseChartData(payload.data ?? payload.chartData);
  const config = parseJsonValue<Record<string, { label?: string; color?: string }>>(payload.config, {});
  const series = parseJsonArrayValue<{ dataKey: string; color?: string; label?: string; kind?: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed' }>(payload.series);
  console.debug('[mapChartComponent] Parsed chart:', {
    title: payload.title,
    dataLength: chartData.length,
    kind: payload.kind,
    xAxisKey: payload.xAxisKey,
    yAxisKey: payload.yAxisKey,
  });

  if (!chartData.length && typeof payload.data === 'string' && payload.data.includes('[object Object]')) {
    console.warn('[mapChartComponent] Dropping non-JSON chart payload string');
  }

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
    kind: normalizeChartKind(payload.kind),
    stacked: payload.stacked,
    layout: normalizeChartLayout(payload.layout),
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
    .filter((comp) => comp && comp.type)
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
        case 'reasoning':
          return `> ${(data.content as string) || ''}`;
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
