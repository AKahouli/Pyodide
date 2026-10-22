import { eventToSseFrame } from './event-mapper';
import { AppBuilderEvent } from '../types/app-builder.types';

describe('eventToSseFrame', () => {
  it('formats a message event as event/data lines', () => {
    const event: AppBuilderEvent = {
      type: 'message',
      payload: { event_id: 'e1', timestamp: 1, role: 'assistant', content: 'hi', attachments: [] },
    };
    const frame = eventToSseFrame(event);
    expect(frame).toBe(
      `event: message\ndata: ${JSON.stringify({ event_id: 'e1', timestamp: 1, role: 'assistant', content: 'hi', attachments: [] })}\n\n`,
    );
  });

  it('formats a done event with empty data object', () => {
    const event: AppBuilderEvent = { type: 'done', payload: { event_id: 'e1', timestamp: 1 } };
    const frame = eventToSseFrame(event);
    expect(frame).toBe(`event: done\ndata: ${JSON.stringify({ event_id: 'e1', timestamp: 1 })}\n\n`);
  });

  it('formats a heartbeat as a comment line', () => {
    expect(eventToSseFrame({ type: 'ping' as any, payload: null as any }, undefined, true)).toBe(': heartbeat\n\n');
  });

  it('includes sequence in the JSON payload when provided', () => {
    const event: AppBuilderEvent = { type: 'done', payload: { event_id: 'e1', timestamp: 1 } };
    const frame = eventToSseFrame(event, 42);
    expect(frame).toBe(
      `event: done\ndata: ${JSON.stringify({ event_id: 'e1', timestamp: 1, sequence: 42 })}\n\n`,
    );
  });
});
