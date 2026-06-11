import {
  ComponentType,
  MessageComponent,
} from '@modules/conversation/interfaces/message.interface';
import { extractComponentData } from '@modules/conversation/utils/component-mapper';

function mergeComponentData(
  type: ComponentType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    case 'text':
    case 'reasoning':
    case 'error': {
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      return { ...existing, content: existingContent + newContent };
    }
    case 'code': {
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      return {
        ...existing,
        content: existingContent + newContent,
        language: (incoming.language as string) || existing.language,
        filename: (incoming.filename as string) || existing.filename,
      };
    }
    default:
      return { ...existing, ...incoming };
  }
}

export const WHATSAPP_ADK_TEXT_COMPONENT_ID = 'whatsapp-adk-text';

function appendLegacyText(buffer: Map<string, MessageComponent>, chunk: string): void {
  const existing = buffer.get(WHATSAPP_ADK_TEXT_COMPONENT_ID);
  if (!existing) {
    buffer.set(WHATSAPP_ADK_TEXT_COMPONENT_ID, {
      id: WHATSAPP_ADK_TEXT_COMPONENT_ID,
      type: 'text',
      data: { content: chunk },
    });
    return;
  }
  existing.data = mergeComponentData('text', existing.data, { content: chunk });
}

function upsertComponent(
  buffer: Map<string, MessageComponent>,
  action: string,
  componentId: string,
  type: ComponentType,
  data: Record<string, unknown>,
): void {
  if (action === 'delete') {
    buffer.delete(componentId);
    return;
  }

  if (action === 'add' || !buffer.has(componentId)) {
    buffer.set(componentId, { id: componentId, type, data: { ...data } });
    return;
  }

  if (action === 'update') {
    const existing = buffer.get(componentId);
    if (existing) {
      existing.data = mergeComponentData(existing.type, existing.data, data);
    }
  }
}

export function applyAdkSseEventToBuffer(
  buffer: Map<string, MessageComponent>,
  event: Record<string, unknown>,
): void {
  const action = event.action as string | undefined;
  const component = event.component as
    | { id?: string; type?: ComponentType; data?: Record<string, unknown> }
    | undefined;

  if (action && component?.id && component.type && component.data) {
    const normalizedType =
      component.type === 'error' ? ('error' as ComponentType) : component.type;
    upsertComponent(buffer, action, component.id, normalizedType, component.data);
    return;
  }

  const chunk = event.chunk;
  const contentType = event.content_type as string | undefined;
  if (typeof chunk !== 'string' || !chunk) {
    return;
  }

  if (contentType === 'description' || contentType === 'function_call') {
    return;
  }

  if (
    contentType === 'chunk' ||
    contentType === 'source' ||
    contentType === 'final_response' ||
    contentType === 'error'
  ) {
    appendLegacyText(buffer, chunk);
  }
}

export function ensureTextComponentFromAccumulated(
  buffer: Map<string, MessageComponent>,
  accumulatedText: string,
): void {
  const trimmed = accumulatedText.trim();
  if (!trimmed) {
    return;
  }

  const existing = buffer.get(WHATSAPP_ADK_TEXT_COMPONENT_ID);
  if (existing?.data?.content) {
    return;
  }

  buffer.set(WHATSAPP_ADK_TEXT_COMPONENT_ID, {
    id: WHATSAPP_ADK_TEXT_COMPONENT_ID,
    type: 'text',
    data: { content: trimmed },
  });
}

export function applyStreamChunkToBuffer(
  buffer: Map<string, MessageComponent>,
  action: string,
  comp: Record<string, unknown>,
): void {
  const componentId = comp.id as string;
  const { type, data } = extractComponentData(comp);
  upsertComponent(buffer, action, componentId, type, data);
}
