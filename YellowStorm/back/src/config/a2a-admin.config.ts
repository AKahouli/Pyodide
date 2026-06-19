import { registerAs } from '@nestjs/config';

/**
 * Configuration for the A2A admin gRPC client. The A2A management API is served
 * by the same backend as the conversation chatbot service, so it reuses the
 * `CONVERSATION_GRPC_URL` endpoint.
 */
export default registerAs('a2aAdmin', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  // Public base of the A2A serving surface (HTTP/JSON-RPC). The gRPC service
  // returns relative agent-card paths (e.g. `/a2a/{id}/.well-known/...`); this
  // base is prepended so callers receive an absolute, reachable URL.
  apiAdkUrl: process.env.API_ADK_URL || '',
  grpcUnaryDeadlineMs: Number.parseInt(
    process.env.A2A_ADMIN_GRPC_UNARY_DEADLINE_MS || '5000',
    10,
  ),
  grpcMaxMessageBytes: Number.parseInt(
    process.env.A2A_ADMIN_GRPC_MAX_MESSAGE_BYTES || `${16 * 1024 * 1024}`,
    10,
  ),
}));
