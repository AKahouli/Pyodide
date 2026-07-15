import { StreamService } from './stream.service';
import type { MessageComponent } from '../interfaces/message.interface';

describe('StreamService guardrail metadata buffering', () => {
  it('preserves guardrail metadata on text update chunks', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();
    const decision = {
      phase: 'output',
      source: 'agent',
      decision: 'block',
      confidence: 0.93,
      attackType: 'system_prompt_extraction',
      target: 'system_prompt',
      reason: 'The response attempted to reveal hidden instructions.',
    };

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'text-1',
      type: 'text',
      data: { content: 'unsafe streamed text' },
    });
    (service as any).applyChunkToBuffer(buffer, 'update', {
      id: 'text-1',
      type: 'text',
      data: { content: 'Blocked by policy.' },
    }, decision);

    expect(buffer.get('text-1')?.data).toEqual({
      content: 'Blocked by policy.',
      guardrailDecision: decision,
    });
  });

  it('keeps initial tool arguments when the terminal update only changes status', () => {
    const service = Object.create(StreamService.prototype) as StreamService;
    const buffer = new Map<string, MessageComponent>();

    (service as any).applyChunkToBuffer(buffer, 'add', {
      id: 'tool-call-1',
      type: 'toolInfo',
      data: { title: 'search_documents', status: 'running', params: '{"query":"contract"}' },
    });
    (service as any).applyChunkToBuffer(buffer, 'update', {
      id: 'tool-call-1',
      type: 'toolInfo',
      data: { title: 'search_documents', status: 'completed' },
    });

    expect(buffer.get('tool-call-1')?.data).toEqual({
      title: 'search_documents',
      status: 'completed',
      params: '{"query":"contract"}',
    });
  });
});
