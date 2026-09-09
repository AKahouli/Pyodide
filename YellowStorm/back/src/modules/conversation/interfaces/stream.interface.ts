import { MessageComponent } from './message.interface';
import type {
  ConversationLatencyMetricsV1,
  StreamChunkLatencyData,
} from './latency.interface';

export type StreamEventType =
  | 'connected'
  | 'heartbeat'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_complete'
  | 'stream_error'
  | 'conversation_name_generated'
  | 'message_created'
  | 'message_updated'
  | 'mention_created'
  | 'stream_resync_required';

export interface StreamConnectedEvent {
  type: 'connected';
  data: { connectionId: string };
}

export interface StreamHeartbeatEvent {
  type: 'heartbeat';
  data: { timestamp: number };
}

export interface StreamStartEvent {
  type: 'stream_start';
  data: { conversationId: string; messageId: string };
}

export interface StreamChunkEvent {
  type: 'stream_chunk';
  data: {
    conversationId: string;
    messageId?: string;
    revision?: number;
    action: string;
    component: MessageComponent;
    metadata?: Record<string, unknown>;
    /** One-time latency envelope on the first model-derived chunk only. */
    latency?: StreamChunkLatencyData;
  };
}

export interface StreamCompleteEvent {
  type: 'stream_complete';
  data: {
    conversationId: string;
    messageId: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
    };
    /** First five server-side metrics; the browser contributes the sixth. */
    latencyMetrics?: ConversationLatencyMetricsV1;
  };
}

export interface StreamErrorEvent {
  type: 'stream_error';
  data: {
    conversationId: string;
    messageId: string;
    errorCode: string;
    message: string;
  };
}

export interface ConversationNameGeneratedEvent {
  type: 'conversation_name_generated';
  data: {
    conversationId: string;
    name: string;
  };
}

export interface MessageCreatedEvent {
  type: 'message_created';
  data: {
    conversationId: string;
    message: any;  
  };
}

export interface MessageUpdatedEvent {
  type: 'message_updated';
  data: {
    conversationId: string;
    messageId: string;
    message: any;  
  };
}

export interface MentionCreatedEvent {
  type: 'mention_created';
  data: {
    conversationId: string;
    messageId: string;
    userId: string;
  };
}

/**
 * Emitted instead of a replay when the server cannot restore event
 * continuity for a reconnecting client (cursor older than the bounded
 * replay window, or a cursor issued by another process). The client must
 * reconcile from canonical conversation state; replay is intentionally
 * withheld so partial history is never mixed with a resync.
 */
export interface StreamResyncRequiredEvent {
  type: 'stream_resync_required';
  data: {
    reason: 'cursor_gap' | 'unknown_instance';
    lastSeenCursor?: string;
    oldestRetainedCursor?: string;
  };
}

export type StreamEvent =
  | StreamConnectedEvent
  | StreamHeartbeatEvent
  | StreamStartEvent
  | StreamChunkEvent
  | StreamCompleteEvent
  | StreamErrorEvent
  | ConversationNameGeneratedEvent
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MentionCreatedEvent
  | StreamResyncRequiredEvent;

export interface InternalSSEConnection {
  connectionId: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface StreamState {
  conversationId: string;
  messageId: string;
  userId: string;
  startedAt: Date;
  components: MessageComponent[];
}

export interface GrpcHealthStatus {
  available: boolean;
  connected: boolean;
  error: string | null;
  lastCheckedAt?: Date;
  activeStreams: number;
  grpcUrl: string;
}
