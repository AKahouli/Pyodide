import { applyChunksToComponents, StreamingBuffer, type BufferedStreamChunk } from './stream-buffer';
import type { ActiveStreamSnapshot, Message, StreamChunkEvent } from './types';

export interface LiveAnswer extends ActiveStreamSnapshot { createdAt: string; }
export const streamKey = (conversationId: string, messageId: string) => `${conversationId}:${messageId}`;
export function liveAnswerTimestamp(answer: LiveAnswer, messages: Message[]): string {
  return messages.find((message) => message.id === answer.messageId)?.createdAt
    || answer.createdAt
    || messages.find((message) => message.id === answer.questionMessageId)?.createdAt
    || messages.at(-1)?.createdAt || '';
}

/** Each reply owns its batching and revision window; siblings never share deltas. */
export class LiveStreamBuffers {
  private buffers = new Map<string, StreamingBuffer>();
  private revisions = new Map<string, number>();
  private closed = new Set<string>();
  private recent = new Map<string, BufferedStreamChunk[]>();
  private snapshotRevisions = new Map<string, number>();
  constructor(private apply: (key: string, chunks: BufferedStreamChunk[]) => void, private recover: (conversationId: string) => void) {}

  start(key: string) { return !this.closed.has(key); }
  push(event: StreamChunkEvent): boolean {
    if (!event.messageId) return false;
    const key = streamKey(event.conversationId, event.messageId);
    if (this.closed.has(key)) return false;
    if (event.revision !== undefined && event.revision <= (this.revisions.get(key) ?? 0)) return false;
    if (event.revision !== undefined) this.revisions.set(key, event.revision);
    this.recent.set(key, [...(this.recent.get(key) ?? []), { action: event.action, component: event.component, revision: event.revision }].slice(-500));
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = new StreamingBuffer();
      buffer.setFlushCallback((chunks) => this.apply(key, chunks));
      buffer.setOverflowCallback(() => this.recover(event.conversationId));
      this.buffers.set(key, buffer);
    }
    buffer.addChunk(event.action, event.component, event.revision);
    return true;
  }
  install(snapshot: ActiveStreamSnapshot): ActiveStreamSnapshot | null {
    const key = streamKey(snapshot.conversationId, snapshot.messageId);
    if (this.closed.has(key) || snapshot.revision < (this.snapshotRevisions.get(key) ?? 0)) return null;
    this.snapshotRevisions.set(key, snapshot.revision);
    const newer = (this.recent.get(key) ?? []).filter((chunk) => (chunk.revision ?? 0) > snapshot.revision);
    const revision = Math.max(snapshot.revision, ...newer.map((chunk) => chunk.revision ?? 0));
    this.revisions.set(key, revision);
    this.buffers.get(key)?.discardThrough(revision);
    return { ...snapshot, revision, components: applyChunksToComponents(snapshot.components, newer) };
  }
  finish(key: string) {
    this.buffers.get(key)?.flush();
    this.buffers.get(key)?.clear();
    this.buffers.delete(key);
    this.revisions.delete(key);
    this.recent.delete(key);
    this.snapshotRevisions.delete(key);
    this.closed.add(key);
    if (this.closed.size > 500) this.closed.delete(this.closed.values().next().value!);
  }
  clear() {
    this.buffers.forEach((buffer) => buffer.clear());
    this.buffers.clear(); this.revisions.clear(); this.closed.clear(); this.recent.clear(); this.snapshotRevisions.clear();
  }
}

export function applyLiveChunks(answer: LiveAnswer, chunks: BufferedStreamChunk[]): LiveAnswer {
  return { ...answer, components: applyChunksToComponents(answer.components, chunks), revision: Math.max(answer.revision, ...chunks.map((chunk) => chunk.revision ?? 0)) };
}
