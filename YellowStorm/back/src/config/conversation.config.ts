import { registerAs } from '@nestjs/config';

export default registerAs('conversation', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  // gRPC channel security (TLS + API key) is shared across all AI-service
  // clients — see config/grpc-security.config.ts (`grpcSecurity` namespace).
  grpcTimeoutMs: parseInt(
    process.env.CONVERSATION_GRPC_TIMEOUT_MS || '120000',
    10,
  ),
  maxConcurrentStreams: parseInt(
    process.env.CONVERSATION_MAX_CONCURRENT_STREAMS || '5',
    10,
  ),
  sseHeartbeatMs: parseInt(
    process.env.CONVERSATION_SSE_HEARTBEAT_MS || '15000',
    10,
  ),
  maxSseConnections: parseInt(
    process.env.CONVERSATION_MAX_SSE_CONNECTIONS || '5',
    10,
  ),
  maxMessageLength: parseInt(
    process.env.CONVERSATION_MAX_MESSAGE_LENGTH || '50000',
    10,
  ),
  maxFilesPerMessage: parseInt(
    process.env.CONVERSATION_MAX_FILES_PER_MESSAGE || '5',
    10,
  ),
  shareExpiryDays: parseInt(
    process.env.CONVERSATION_SHARE_EXPIRY_DAYS || '30',
    10,
  ),
  systemWorkspaceStorageBytes: parseInt(
    process.env.CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES || '52428800',
    10,
  ),
  staleStreamCleanupMinutes: 30,
  orphanedConversationThresholdHours: parseInt(
    process.env.CONVERSATION_ORPHANED_THRESHOLD_HOURS || '24',
    10,
  ),
}));
