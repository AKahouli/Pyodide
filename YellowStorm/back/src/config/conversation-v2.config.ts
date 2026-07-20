import { registerAs } from '@nestjs/config';

export default registerAs('conversationV2', () => ({
  grpcUrl: process.env.CONVERSATION_V2_GRPC_URL || 'localhost:50051',
  grpcUnaryDeadlineMs: Number.parseInt(
    process.env.CONVERSATION_V2_GRPC_UNARY_DEADLINE_MS || '5000',
    10,
  ),
  grpcStreamDeadlineMs: Number.parseInt(
    process.env.CONVERSATION_V2_GRPC_STREAM_DEADLINE_MS || '900000',
    10,
  ),
  sseHeartbeatMs: Number.parseInt(
    process.env.CONVERSATION_V2_SSE_HEARTBEAT_MS || '15000',
    10,
  ),
  maxMessageLength: Number.parseInt(
    process.env.CONVERSATION_V2_MAX_MESSAGE_LENGTH || '16384',
    10,
  ),
  grpcMaxMessageBytes: Number.parseInt(
    process.env.CONVERSATION_V2_GRPC_MAX_MESSAGE_BYTES || `${16 * 1024 * 1024}`,
    10,
  ),
  liveTailPollMs: Number.parseInt(
    process.env.CONVERSATION_V2_LIVE_TAIL_POLL_MS || '1000',
    10,
  ),
  /**
   * Max number of conversations a single user may stream concurrently. Mirrors
   * v1 `conversation.maxConcurrentStreams`. Background streams keep running
   * server-side independent of which conversation the client is viewing.
   */
  maxConcurrentStreams: Number.parseInt(
    process.env.CONVERSATION_V2_MAX_CONCURRENT_STREAMS || '5',
    10,
  ),
  /**
   * Max number of open SSE pipe connections per user (e.g., multiple tabs).
   * Mirrors v1 `conversation.maxSseConnections`.
   */
  maxSseConnections: Number.parseInt(
    process.env.CONVERSATION_V2_MAX_SSE_CONNECTIONS || '5',
    10,
  ),
  /**
   * Idle timeout for a background gRPC chat stream: if no event is received
   * for this long the stream is cancelled and a terminal error is emitted.
   * Resets on every received event. Mirrors v1 `conversation.grpcTimeoutMs`.
   */
  grpcIdleTimeoutMs: Number.parseInt(
    process.env.CONVERSATION_V2_GRPC_IDLE_TIMEOUT_MS || '120000',
    10,
  ),
  appBuilderDeployBaseUrl: process.env.APP_BUILDER_DEPLOY_BASE_URL,
  appBuilderDeployToken: process.env.APP_BUILDER_DEPLOY_TOKEN,
  appBuilderDeployTimeoutMs: Number.parseInt(
    process.env.APP_BUILDER_DEPLOY_TIMEOUT_MS || `${10 * 60 * 1000}`,
    10,
  ),
  appBuilderDeployInitialStatusDelayMs: Number.parseInt(
    process.env.APP_BUILDER_DEPLOY_INITIAL_STATUS_DELAY_MS || '20000',
    10,
  ),
  appBuilderDeployStatusPollIntervalMs: Number.parseInt(
    process.env.APP_BUILDER_DEPLOY_STATUS_POLL_INTERVAL_MS || '15000',
    10,
  ),
}));
