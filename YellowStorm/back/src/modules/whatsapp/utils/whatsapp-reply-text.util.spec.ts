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

  it('falls back to agent activity summaries when no text is available', () => {
    const result = extractWhatsAppReplyText([
      component({ id: 'cmp-1', type: 'agentActivity', data: { summary: 'Preparing the answer', status: 'completed' } }),
      component({ id: 'cmp-2', type: 'agentActivity', data: { summary: 'Checking the result', status: 'completed' } }),
    ]);

    expect(result).toBe('Preparing the answer\nChecking the result');
  });

  it('falls back to task item text when no text or activity is available', () => {
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
