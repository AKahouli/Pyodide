import { ConversationV2Event } from '../types/conversation-v2.types';

export function eventToSseFrame(event: ConversationV2Event, isHeartbeat = false): string {
  if (isHeartbeat) {
    return ': heartbeat\n\n';
  }
  return `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}
