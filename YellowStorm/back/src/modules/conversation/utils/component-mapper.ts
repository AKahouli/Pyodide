import { ComponentType } from '../interfaces/message.interface';
import { normalizeChoiceComponentData } from './choice-component-normalizer';
import { redactTaskDiagnosticText } from './task-diagnostics';
import { sanitizeSerializedToolValue } from './public-component-sanitizer';

const ONEOF_FIELD_TYPES: ReadonlyArray<{ field: string; type: ComponentType }> = [
  { field: 'text', type: 'text' },
  { field: 'agent_activity', type: 'agentActivity' },
  { field: 'code', type: 'code' },
  { field: 'error', type: 'error' },
  { field: 'plan', type: 'plan' },
  { field: 'queue', type: 'queue' },
  { field: 'checkpoint', type: 'checkpoint' },
  { field: 'chart', type: 'chart' },
  { field: 'task', type: 'task' },
  { field: 'sources', type: 'sources' },
  { field: 'sandbox', type: 'sandbox' },
  { field: 'web_preview', type: 'webPreview' },
  { field: 'artifact', type: 'artifact' },
  { field: 'citation', type: 'citation' },
  { field: 'tool_activity', type: 'toolActivity' },
  { field: 'choice', type: 'choice' },
];

const LEGACY_TYPE_MAP: Record<string, ComponentType> = {
  text: 'text',
  code: 'code',
  agent_activity: 'agentActivity',
  agentActivity: 'agentActivity',
  plan: 'plan',
  queue: 'queue',
  checkpoint: 'checkpoint',
  chart: 'chart',
  task: 'task',
  error: 'error',
  sources: 'sources',
  sandbox: 'sandbox',
  web_preview: 'webPreview',
  webPreview: 'webPreview',
  artifact: 'artifact',
  citation: 'citation',
  tool_activity: 'toolActivity',
  toolActivity: 'toolActivity',
  choice: 'choice',
};

function normalizeLegacyType(raw: string): ComponentType {
  return LEGACY_TYPE_MAP[raw] ?? 'text';
}

function oneofPayloadHasContent(type: ComponentType, payload: Record<string, unknown>): boolean {
  switch (type) {
    case 'text':
    case 'code':
    case 'webPreview':
      return typeof payload.content === 'string' && payload.content.length > 0;
    case 'error':
      return (
        (typeof payload.title === 'string' && payload.title.length > 0) ||
        (typeof payload.content === 'string' && payload.content.length > 0)
      );
    case 'sandbox':
      return (
        (typeof payload.output === 'string' && payload.output.length > 0) ||
        (typeof payload.code === 'string' && payload.code.length > 0)
      );
    case 'plan':
      return Array.isArray(payload.steps) && payload.steps.length > 0;
    case 'queue':
      return Array.isArray(payload.items) && payload.items.length > 0;
    case 'task':
      return Array.isArray(payload.items) && payload.items.length > 0;
    case 'sources':
      return Array.isArray(payload.sources) && payload.sources.length > 0;
    case 'checkpoint':
      return typeof payload.label === 'string' && payload.label.length > 0;
    case 'chart':
      return typeof payload.title === 'string' && payload.title.length > 0;
    case 'artifact':
      return (
        (typeof payload.filename === 'string' && payload.filename.length > 0) ||
        (typeof payload.file_path === 'string' && payload.file_path.length > 0)
      );
    case 'citation':
      return Boolean(payload.text_source || payload.image_source);
    case 'agentActivity':
      return typeof payload.summary === 'string' && payload.summary.length > 0;
    case 'toolActivity':
      return (
        (typeof payload.tool_name === 'string' && payload.tool_name.length > 0) ||
        (typeof payload.status === 'string' && payload.status.length > 0)
      );
    case 'choice':
      return normalizeChoiceComponentData(payload) !== null;
    default:
      return false;
  }
}

/**
 * Determines component type from the proto Component oneof (or legacy type/data shape).
 * With proto-loader `defaults: true`, empty oneof branches are still truthy objects — pick the branch that has content.
 */
export function getComponentType(comp: any): ComponentType {
  if (!comp || typeof comp !== 'object') return 'text';

  if (typeof comp.type === 'string' && comp.data && typeof comp.data === 'object') {
    return normalizeLegacyType(comp.type);
  }

  if (typeof comp.data === 'string') {
    const selected = ONEOF_FIELD_TYPES.find(({ field }) => field === comp.data);
    if (selected) return selected.type;
  }

  for (const { field, type } of ONEOF_FIELD_TYPES) {
    const payload = comp[field];
    if (payload && typeof payload === 'object' && oneofPayloadHasContent(type, payload as Record<string, unknown>)) {
      return type;
    }
  }

  for (const { field, type } of ONEOF_FIELD_TYPES) {
    if (comp[field] && typeof comp[field] === 'object') {
      return type;
    }
  }

  return 'text';
}

/**
 * Extracts component data from a gRPC chunk component into our internal format.
 * Handles the proto oneof structure where the type is determined by which field is set.
 */
export function extractComponentData(comp: any): { type: ComponentType; data: Record<string, unknown> } {
  if (!comp || typeof comp !== 'object') {
    return { type: 'text', data: { content: '' } };
  }

  if (typeof comp.type === 'string' && comp.data && typeof comp.data === 'object') {
    const type = normalizeLegacyType(comp.type);
    const data = comp.data as Record<string, unknown>;
    if (type === 'choice') {
      const normalized = normalizeChoiceComponentData(data);
      return normalized ? { type, data: normalized } : { type: 'text', data: { content: '' } };
    }
    return { type, data: { ...data } };
  }

  const type = getComponentType(comp);

  const parseJsonArray = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const parseJsonObject = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  switch (type) {
    case 'text':
      return {
        type,
        data: {
          content: comp.text?.content || '',
          outputPortId: comp.text?.output_port_id || '',
          output_port_id: comp.text?.output_port_id || '',
        },
      };
    case 'code':
      return {
        type,
        data: {
          content: comp.code?.content || '',
          language: comp.code?.language || '',
          filename: comp.code?.filename || '',
          outputPortId: comp.code?.output_port_id || '',
          output_port_id: comp.code?.output_port_id || '',
        },
      };
    case 'agentActivity':
      return {
        type,
        data: {
          summary: comp.agent_activity?.summary || '',
          status: comp.agent_activity?.status || 'running',
          ...(comp.agent_activity?.started_at ? { startedAt: comp.agent_activity.started_at } : {}),
          ...(comp.agent_activity?.completed_at ? { completedAt: comp.agent_activity.completed_at } : {}),
          ...(comp.agent_activity?.duration_ms !== undefined ? { durationMs: Number(comp.agent_activity.duration_ms) } : {}),
          ...(comp.agent_activity?.actor_id ? { actorId: comp.agent_activity.actor_id } : {}),
          ...(comp.agent_activity?.actor_name ? { actorName: comp.agent_activity.actor_name } : {}),
        },
      };
    case 'plan':
      return {
        type,
        data: {
          title: comp.plan?.title || '',
          description: comp.plan?.description || '',
          steps: (comp.plan?.steps || []).map((s: any) => ({
            task: s.task || '',
            agent: s.agent || '',
            status: mapTaskStatus(s.status),
          })),
          status: mapTaskStatus(comp.plan?.status),
        },
      };
    case 'queue':
      return {
        type,
        data: {
          title: comp.queue?.title || '',
          items: (comp.queue?.items || []).map((item: any) => ({
            id: item.id || '',
            title: item.title || '',
            status: item.status || 'pending',
          })),
        },
      };
    case 'checkpoint':
      return {
        type,
        data: { label: comp.checkpoint?.label || '' },
      };
    case 'chart':
      const chart = comp.chart || {};
      const normalizedData = parseJsonArray(chart.data || chart.chartData || []);
      return {
        type,
        data: {
          title: chart.title || '',
          data: chart.data || chart.chartData || [],
          chartData: chart.data || chart.chartData || '',
          config: chart.config || '',
          xAxisKey: chart.xAxisKey || chart.x_axis_key || '',
          series: parseJsonArray(chart.series),
          kind: chart.kind || 'CHART_KIND_UNSPECIFIED',
          yAxisKey: chart.yAxisKey || chart.y_axis_key || '',
          stacked: chart.stacked || false,
          layout: chart.layout || 'CHART_LAYOUT_UNSPECIFIED',
          innerRadius: chart.inner_radius || chart.innerRadius || 0,
          showLegend: chart.show_legend ?? chart.showLegend ?? true,
          showGrid: chart.show_grid ?? chart.showGrid ?? true,
          nameKey: chart.nameKey || chart.name_key || '',
          zAxisKey: chart.zAxisKey || chart.z_axis_key || '',
        },
      };
    case 'task':
      return {
        type,
        data: {
          title: comp.task?.title || '',
          items: (comp.task?.items || []).map((item: any) => redactTaskDiagnosticText(item.text || '')),
          status: comp.task?.status || 'pending',
        },
      };
    case 'error':
      return {
        type,
        data: {
          title: comp.error?.title || '',
          content: comp.error?.content || '',
        },
      };
    case 'sources':
      return {
        type,
        data: {
          sources: (comp.sources?.sources || []).map((s: any) => ({
            title: s.title || '',
            url: s.url || '',
          })),
        },
      };
    case 'sandbox':
      return {
        type,
        data: {
          code: comp.sandbox?.code || '',
          output: comp.sandbox?.output || '',
          error: comp.sandbox?.error || '',
          outputAvailable: comp.sandbox?.output_available || false,
        },
      };
    case 'webPreview':
      return {
        type,
        data: {
          content: comp.web_preview?.content || '',
        },
      };
    case 'artifact':
      return {
        type,
        data: {
          storagePath: comp.artifact?.file_path || '',
          filename: comp.artifact?.filename || '',
          outputPortId: comp.artifact?.output_port_id || '',
          output_port_id: comp.artifact?.output_port_id || '',
          artifactKind: comp.artifact?.artifact_kind || '',
          artifact_kind: comp.artifact?.artifact_kind || '',
          mimeType: comp.artifact?.mime_type || '',
          artifactId: comp.artifact?.artifact_id || '',
          producerToolId: comp.artifact?.producer_tool_id || '',
          sizeBytes: Number(comp.artifact?.size_bytes || 0),
          availability: comp.artifact?.availability || 'ready',
        },
      };
    case 'citation': {
      const citation = comp.citation;
      const sourceData: Record<string, unknown> = { parentId: citation?.parent_id || '' };

      if (citation?.text_source) {
        sourceData.sourceType = 'text';
        sourceData.source = citation.text_source.source || '';
        sourceData.fileName = citation.text_source.file_name || '';
        sourceData.page = citation.text_source.page || '';
        sourceData.pageContent = citation.text_source.page_content || '';
        sourceData.workspaceId = citation.text_source.workspace_id || '';
        sourceData.reference = citation.text_source.reference || '';
        sourceData.highlightText = citation.text_source.highlight_text || '';
        sourceData.highlightBBox = citation.text_source.highlight_bbox || [];
        sourceData.blockBBox = citation.text_source.block_bbox || [];
      } else if (citation?.image_source) {
        sourceData.sourceType = 'image';
        sourceData.path = citation.image_source.path || '';
        sourceData.page = citation.image_source.page || '';
        sourceData.fileName = citation.image_source.file_name || '';
        sourceData.workspaceName = citation.image_source.workspace_name || '';
        sourceData.workspaceId = citation.image_source.workspace_id || '';
        sourceData.height = citation.image_source.height || '';
        sourceData.width = citation.image_source.width || '';
        sourceData.reference = citation.image_source.reference || '';
        sourceData.highlightText = citation.image_source.highlight_text || '';
        sourceData.highlightBBox = citation.image_source.highlight_bbox || [];
        sourceData.blockBBox = citation.image_source.block_bbox || [];
      }

      return { type: 'citation' as ComponentType, data: sourceData };
    }
    case 'toolActivity': {
      const toolActivity = comp.tool_activity;
      return {
        type,
        data: {
          toolName: toolActivity?.tool_name || '',
          status: toolActivity?.status || 'running',
          paramsJson: sanitizeSerializedToolValue(toolActivity?.params_json || ''),
          ...(toolActivity?.result_json ? { resultJson: sanitizeSerializedToolValue(toolActivity.result_json) } : {}),
          ...(toolActivity?.started_at ? { startedAt: toolActivity.started_at } : {}),
          ...(toolActivity?.completed_at ? { completedAt: toolActivity.completed_at } : {}),
          ...(toolActivity?.duration_ms !== undefined ? { durationMs: Number(toolActivity.duration_ms) } : {}),
          ...(toolActivity?.display_key ? { displayKey: toolActivity.display_key } : {}),
          ...(toolActivity?.fallback_display_name ? { fallbackDisplayName: toolActivity.fallback_display_name } : {}),
          summary: toolActivity?.summary || '',
          renderKind: toolActivity?.render_kind || 'generic',
          ...(toolActivity?.actor_id ? { actorId: toolActivity.actor_id } : {}),
          ...(toolActivity?.actor_name ? { actorName: toolActivity.actor_name } : {}),
          ...(toolActivity?.primary_input ? { primaryInput: toolActivity.primary_input } : {}),
          ...(toolActivity?.primary_input_language ? { primaryInputLanguage: toolActivity.primary_input_language } : {}),
        },
      };
    }
    case 'choice': {
      const normalized = normalizeChoiceComponentData(comp.choice);
      return normalized ? { type, data: normalized } : { type: 'text', data: { content: '' } };
    }
    default:
      return { type: 'text', data: { content: '' } };
  }
}

/**
 * Maps proto TaskStatus enum values to lowercase strings for frontend compatibility.
 * Proto enum values come as: "PENDING", "IN_PROGRESS", "COMPLETED", "ERROR"
 * Frontend expects: "pending", "in_progress", "completed", "error"
 */
export function mapTaskStatus(status: string | undefined): string {
  if (!status) return 'pending';

  const statusMap: Record<string, string> = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    ERROR: 'error',
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
    error: 'error',
  };

  return statusMap[status] || 'pending';
}

/** Merges answer content from streamed components for plain-text consumers (widget, telegram). */
export function aggregateTextFromComponents(
  components: Array<{ type: ComponentType | string; data: Record<string, unknown> }>,
): string {
  let replyText = '';
  for (const component of components) {
    if (component.type === 'text' && typeof component.data.content === 'string') {
      replyText += component.data.content;
      continue;
    }
    if (component.type === 'code' && typeof component.data.content === 'string') {
      replyText += component.data.content;
      continue;
    }
    if (component.type === 'error') {
      const title = typeof component.data.title === 'string' ? component.data.title : '';
      const content = typeof component.data.content === 'string' ? component.data.content : '';
      const combined = [title, content].filter(Boolean).join(': ');
      if (combined) replyText += combined;
    }
  }
  return replyText;
}
