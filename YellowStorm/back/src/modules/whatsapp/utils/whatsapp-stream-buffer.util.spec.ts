import {
  applyAdkSseEventToBuffer,
  ensureTextComponentFromAccumulated,
  WHATSAPP_ADK_TEXT_COMPONENT_ID,
} from './whatsapp-stream-buffer.util';
import { extractTextFromAdkSseEvent, extractWhatsAppReplyText } from './whatsapp-reply-text.util';

describe('whatsapp ADK SSE parsing', () => {
  it('captures legacy chunk events', () => {
    const buffer = new Map();
    applyAdkSseEventToBuffer(buffer, {
      chunk: 'Hello',
      content_type: 'chunk',
    });
    expect(extractWhatsAppReplyText(Array.from(buffer.values()))).toBe('Hello');
  });

  it('ignores legacy description events', () => {
    const buffer = new Map();
    applyAdkSseEventToBuffer(buffer, {
      chunk: 'Starting chef cuisine...',
      content_type: 'description',
    });
    expect(buffer.size).toBe(0);
  });

  it('captures legacy error events', () => {
    const buffer = new Map();
    applyAdkSseEventToBuffer(buffer, {
      chunk: 'Error: model unavailable',
      content_type: 'error',
    });
    expect(extractWhatsAppReplyText(Array.from(buffer.values()))).toContain('model unavailable');
  });

  it('captures component text updates', () => {
    const buffer = new Map();
    applyAdkSseEventToBuffer(buffer, {
      action: 'add',
      component: {
        id: 'c1',
        type: 'text',
        data: { content: 'Hi' },
      },
    });
    applyAdkSseEventToBuffer(buffer, {
      action: 'update',
      component: {
        id: 'c1',
        type: 'text',
        data: { content: ' there' },
      },
    });
    expect(extractWhatsAppReplyText(Array.from(buffer.values()))).toBe('Hi there');
  });

  it('falls back to accumulated text when buffer has no content', () => {
    const buffer = new Map();
    ensureTextComponentFromAccumulated(buffer, 'Fallback reply');
    expect(buffer.get(WHATSAPP_ADK_TEXT_COMPONENT_ID)?.data.content).toBe('Fallback reply');
  });

  it('extractTextFromAdkSseEvent reads chunk payloads', () => {
    expect(
      extractTextFromAdkSseEvent({ chunk: 'Answer', content_type: 'chunk' }),
    ).toBe('Answer');
    expect(
      extractTextFromAdkSseEvent({ chunk: 'Starting x...', content_type: 'description' }),
    ).toBe('');
  });
});
