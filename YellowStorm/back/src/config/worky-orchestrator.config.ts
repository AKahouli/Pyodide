import { registerAs } from '@nestjs/config';

export default registerAs('workyOrchestrator', () => ({
  grpcUrl: process.env.WORKY_ORCHESTRATOR_GRPC_URL || 'localhost:50052',
  // RunTask acks fast (fire-and-forget; progress streams via Electric) but we
  // give this headroom over conversation-v2's 5s default for slower cold starts.
  grpcUnaryDeadlineMs: Number.parseInt(
    process.env.WORKY_ORCHESTRATOR_GRPC_UNARY_DEADLINE_MS || '15000',
    10,
  ),
  grpcMaxMessageBytes: Number.parseInt(
    process.env.WORKY_ORCHESTRATOR_GRPC_MAX_MESSAGE_BYTES || `${16 * 1024 * 1024}`,
    10,
  ),
  // Idle timeout for the channel; mirrors conversation-v2's grpcIdleTimeoutMs.
  grpcIdleTimeoutMs: Number.parseInt(
    process.env.WORKY_ORCHESTRATOR_GRPC_IDLE_TIMEOUT_MS || '120000',
    10,
  ),
}));
