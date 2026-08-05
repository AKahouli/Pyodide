import { eventToSseFrame } from './event-mapper';
import type { ConversationV2Event } from '../types/conversation-v2.types';

describe('event-mapper app_build_progress', () => {
  it('formats app_build_progress SSE frames', () => {
    const event: ConversationV2Event = {
      type: 'app_build_progress',
      payload: {
        event_id: 'p1',
        timestamp: 1,
        phase: 'fetching_app_code',
        message: 'Fetching source metadata from sandbox manager',
      },
    };
    const frame = eventToSseFrame(event, 42);
    expect(frame).toContain('event: app_build_progress');
    expect(frame).toContain('"phase":"fetching_app_code"');
    expect(frame).toContain('"sequence":42');
  });
});
