import type { Message } from '../types';

/**
 * Insert a freshly persisted message at its chronological position instead of
 * blindly appending. SSE `message.created` events can arrive before the slower
 * POST response that produced the triggering user message — appending the late
 * user message would render the prompt AFTER its answer. Stable: equal
 * timestamps keep existing order, so a normal newest-last append is unchanged.
 */
export function insertMessageChronologically(messages: Message[], incoming: Message): Message[] {
  const incomingTime = Date.parse(incoming.createdAt);
  if (Number.isNaN(incomingTime)) return [...messages, incoming];
  let insertAt = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const time = Date.parse(messages[i].createdAt);
    if (Number.isNaN(time) || time <= incomingTime) break;
    insertAt = i;
  }
  return [...messages.slice(0, insertAt), incoming, ...messages.slice(insertAt)];
}
