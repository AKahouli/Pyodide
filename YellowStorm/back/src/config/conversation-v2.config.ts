import { registerAs } from '@nestjs/config';

export default registerAs('conversationV2', () => ({
  grpcUrl: process.env.CONVERSATION_V2_GRPC_URL || 'localhost:50051',
  grpcUnaryDeadlineMs: parseInt(
    process.env.CONVERSATION_V2_GRPC_UNARY_DEADLINE_MS || '5000',
    10,
  ),
  grpcStreamDeadlineMs: parseInt(
    process.env.CONVERSATION_V2_GRPC_STREAM_DEADLINE_MS || '900000',
    10,
  ),
  sseHeartbeatMs: parseInt(
    process.env.CONVERSATION_V2_SSE_HEARTBEAT_MS || '15000',
    10,
  ),
  maxMessageLength: parseInt(
    process.env.CONVERSATION_V2_MAX_MESSAGE_LENGTH || '16384',
    10,
  ),
  grpcMaxMessageBytes: parseInt(
    process.env.CONVERSATION_V2_GRPC_MAX_MESSAGE_BYTES || `${16 * 1024 * 1024}`,
    10,
  ),
}));
