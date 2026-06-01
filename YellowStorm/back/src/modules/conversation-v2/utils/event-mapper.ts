import { ConversationV2Event } from '../types/conversation-v2.types';

export function eventToSseFrame(
  event: ConversationV2Event,
  sequence?: number,
  isHeartbeat = false,
): string {
  if (isHeartbeat) {
    return ': heartbeat\n\n';
  }
  // Include the persisted sequence number inside the JSON payload so the
  // client can de-dupe and gap-detect. `sequence` is optional only because
  // the legacy error frame in the controller doesn't have a row to assign.
  const data =
    sequence === undefined
      ? event.payload
      : { ...(event.payload as unknown as Record<string, unknown>), sequence };
  return `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
}
