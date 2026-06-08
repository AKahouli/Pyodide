import { registerAs } from '@nestjs/config';

/**
 * Configuration for the A2A admin gRPC client. The A2A management API is served
 * by the same backend as the conversation chatbot service, so it reuses the
 * `CONVERSATION_GRPC_URL` endpoint.
 */
export default registerAs('a2aAdmin', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  grpcUnaryDeadlineMs: parseInt(
    process.env.A2A_ADMIN_GRPC_UNARY_DEADLINE_MS || '5000',
    10,
  ),
  grpcMaxMessageBytes: parseInt(
    process.env.A2A_ADMIN_GRPC_MAX_MESSAGE_BYTES || `${16 * 1024 * 1024}`,
    10,
  ),
}));
