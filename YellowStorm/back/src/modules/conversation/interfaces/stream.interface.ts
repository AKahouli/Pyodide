import { MessageComponent } from './message.interface';

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
  | 'mention_created';

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
  };
}

export interface StreamErrorEvent {
  type: 'stream_error';
  data: {
    conversationId: string;
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
  | MentionCreatedEvent;

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
