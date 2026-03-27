import { ComponentType } from '../interfaces/message.interface';

/**
 * Determines component type from the oneof field set in the proto Component message.
 */
export function getComponentType(comp: any): ComponentType {
  if (comp.text) return 'text';
  if (comp.code) return 'code';
  if (comp.reasoning) return 'reasoning';
  if (comp.plan) return 'plan';
  if (comp.queue) return 'queue';
  if (comp.checkpoint) return 'checkpoint';
  if (comp.chart) return 'chart';
  if (comp.task) return 'task';
  if (comp.error) return 'error';
  if (comp.sources) return 'sources';
  if (comp.sandbox) return 'sandbox';
  if (comp.web_preview) return 'webPreview';
  if (comp.artifact) return 'artifact';
  if (comp.citation) return 'citation';
  return 'text';
}

/**
 * Extracts component data from a gRPC chunk component into our internal format.
 * Handles the proto oneof structure where the type is determined by which field is set.
 */
export function extractComponentData(comp: any): { type: ComponentType; data: Record<string, unknown> } {
  const type = getComponentType(comp);

  switch (type) {
    case 'text':
      return {
        type,
        data: { content: comp.text?.content || '' },
      };
    case 'code':
      return {
        type,
        data: {
          content: comp.code?.content || '',
          language: comp.code?.language || '',
          filename: comp.code?.filename || '',
        },
      };
    case 'reasoning':
      return {
        type,
        data: {
          content: comp.reasoning?.content || '',
          duration: comp.reasoning?.duration || 0,
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
      return {
        type,
        data: {
          title: comp.chart?.title || '',
          chartData: comp.chart?.data || '',
          config: comp.chart?.config || '',
          xAxisKey: comp.chart?.xAxisKey || '',
          series: comp.chart?.series || '',
        },
      };
    case 'task':
      return {
        type,
        data: {
          title: comp.task?.title || '',
          items: (comp.task?.items || []).map((item: any) => item.text || ''),
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
          filePath: comp.artifact?.file_path || '',
          filename: comp.artifact?.filename || '',
        },
      };
    case 'citation': {
      const citation = comp.citation;
      const sourceData: Record<string, unknown> = { parentId: citation?.parent_id || '' };

      if (citation?.text_source) {
        sourceData.sourceType = 'text';
        sourceData.source = citation.text_source.source || '';
        sourceData.externalId = citation.text_source.external_id || '';
        sourceData.page = citation.text_source.page || '';
        sourceData.pageContent = citation.text_source.page_content || '';
        sourceData.workspaceId = citation.text_source.workspace_id || '';
        sourceData.reference = citation.text_source.reference || '';
      } else if (citation?.image_source) {
        sourceData.sourceType = 'image';
        sourceData.path = citation.image_source.path || '';
        sourceData.page = citation.image_source.page || '';
        sourceData.fileName = citation.image_source.file_name || '';
        sourceData.externalId = citation.image_source.external_id || '';
        sourceData.workspaceId = citation.image_source.workspace_id || '';
        sourceData.height = citation.image_source.height || '';
        sourceData.width = citation.image_source.width || '';
        sourceData.reference = citation.image_source.reference || '';
      }

      return { type: 'citation' as ComponentType, data: sourceData };
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
