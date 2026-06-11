import { MessageComponent } from '@modules/conversation/interfaces/message.interface';

const STARTING_PREFIX = /^Starting .+\.\.\.$/;

export function extractTextFromAdkSseEvent(event: Record<string, unknown>): string {
  const component = event.component as
    | { type?: string; data?: Record<string, unknown> }
    | undefined;

  if (component?.type && component.data) {
    if (component.type === 'text' || component.type === 'error') {
      return String(component.data.content || '');
    }
    if (component.type === 'reasoning') {
      return String(component.data.content || '');
    }
    if (component.type === 'task') {
      const items = component.data.items;
      if (Array.isArray(items)) {
        return items
          .map((item) => String((item as { text?: string })?.text || ''))
          .filter(Boolean)
          .join('\n');
      }
    }
  }

  const chunk = event.chunk;
  const contentType = event.content_type as string | undefined;
  if (typeof chunk !== 'string' || !chunk) {
    return '';
  }

  if (contentType === 'description' || contentType === 'function_call') {
    return '';
  }

  if (
    contentType === 'chunk' ||
    contentType === 'source' ||
    contentType === 'final_response' ||
    contentType === 'error'
  ) {
    return chunk;
  }

  return '';
}

export function extractWhatsAppReplyText(components?: MessageComponent[]): string {
  if (!components?.length) {
    return '';
  }

  const textBlocks = components
    .filter((component) => component.type === 'text' || component.type === 'error')
    .map((component) => String(component.data?.content || ''))
    .filter((line) => line && !STARTING_PREFIX.test(line.trim()));

  if (textBlocks.length) {
    return textBlocks.join('\n').trim();
  }

  const reasoningBlocks = components
    .filter((component) => component.type === 'reasoning')
    .map((component) => String(component.data?.content || ''))
    .filter(Boolean);

  if (reasoningBlocks.length) {
    return reasoningBlocks.join('\n').trim();
  }

  const taskBlocks = components
    .filter((component) => component.type === 'task')
    .flatMap((component) => {
      const items = component.data?.items;
      if (!Array.isArray(items)) {
        return [];
      }
      return items
        .map((item) => String((item as { text?: string })?.text || ''))
        .filter((line) => line && !STARTING_PREFIX.test(line.trim()));
    });

  return taskBlocks.join('\n').trim();
}
