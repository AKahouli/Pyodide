import { MessageComponent } from '@modules/conversation/interfaces/message.interface';
import { extractWhatsAppReplyText } from './whatsapp-reply-text.util';

function component(
  partial: Pick<MessageComponent, 'type' | 'data'> & { id?: string },
): MessageComponent {
  return { id: partial.id ?? 'cmp-1', type: partial.type, data: partial.data };
}

describe('extractWhatsAppReplyText', () => {
  it('returns empty string when components are missing', () => {
    expect(extractWhatsAppReplyText()).toBe('');
    expect(extractWhatsAppReplyText([])).toBe('');
  });

  it('joins text and error components while skipping starting placeholders', () => {
    const result = extractWhatsAppReplyText([
      component({ type: 'text', data: { content: 'Starting agent...' } }),
      component({ id: 'cmp-2', type: 'text', data: { content: 'Hello from agent' } }),
      component({ id: 'cmp-3', type: 'error', data: { content: 'Minor warning' } }),
    ]);

    expect(result).toBe('Hello from agent\nMinor warning');
  });

  it('falls back to reasoning blocks when no text is available', () => {
    const result = extractWhatsAppReplyText([
      component({ id: 'cmp-1', type: 'reasoning', data: { content: 'Thinking step 1' } }),
      component({ id: 'cmp-2', type: 'reasoning', data: { content: 'Thinking step 2' } }),
    ]);

    expect(result).toBe('Thinking step 1\nThinking step 2');
  });

  it('falls back to task item text when no text or reasoning is available', () => {
    const result = extractWhatsAppReplyText([
      component({
        type: 'task',
        data: {
          items: [{ text: 'Starting task...' }, { text: 'Task result' }],
        },
      }),
    ]);

    expect(result).toBe('Task result');
  });
});
