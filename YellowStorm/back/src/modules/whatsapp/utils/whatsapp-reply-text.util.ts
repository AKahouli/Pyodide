import { MessageComponent } from '@modules/conversation/interfaces/message.interface';

const STARTING_PREFIX = /^Starting .+\.\.\.$/;

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

  const activityBlocks = components
    .filter((component) => component.type === 'agentActivity')
    .map((component) => String(component.data?.summary || ''))
    .filter(Boolean);

  if (activityBlocks.length) {
    return activityBlocks.join('\n').trim();
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
