import { registerAs } from '@nestjs/config';

export default registerAs('conversation', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  // gRPC channel security (TLS + API key) is shared across all AI-service
  // clients — see config/grpc-security.config.ts (`grpcSecurity` namespace).
  grpcTimeoutMs: Number.parseInt(process.env.CONVERSATION_GRPC_TIMEOUT_MS || '120000', 10),
  maxConcurrentStreams: Number.parseInt(process.env.CONVERSATION_MAX_CONCURRENT_STREAMS || '5', 10),
  sseHeartbeatMs: Number.parseInt(process.env.CONVERSATION_SSE_HEARTBEAT_MS || '15000', 10),
  maxSseConnections: Number.parseInt(process.env.CONVERSATION_MAX_SSE_CONNECTIONS || '5', 10),
  // Bounded per-user SSE replay window so a reconnecting client can recover
  // events missed while it had no connection. Not a durable event store.
  sseReplayEnabled: (process.env.CONVERSATION_SSE_REPLAY_ENABLED || 'true') === 'true',
  sseReplayMaxEvents: Number.parseInt(process.env.CONVERSATION_SSE_REPLAY_MAX_EVENTS || '200', 10),
  sseReplayTtlMs: Number.parseInt(process.env.CONVERSATION_SSE_REPLAY_TTL_MS || '120000', 10),
  maxMessageLength: Number.parseInt(process.env.CONVERSATION_MAX_MESSAGE_LENGTH || '50000', 10),
  maxFilesPerMessage: Number.parseInt(process.env.CONVERSATION_MAX_FILES_PER_MESSAGE || '5', 10),
  shareExpiryDays: Number.parseInt(process.env.CONVERSATION_SHARE_EXPIRY_DAYS || '30', 10),
  systemWorkspaceStorageBytes: Number.parseInt(process.env.CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES || '52428800', 10),
  staleStreamCleanupMinutes: 30,
  // Standard-run recovery worker (WP06.5): settles crashed attempts whose
  // execution lease expired, per fleet, as `interrupted` — never `completed`.
  recoveryEnabled: (process.env.CONVERSATION_RECOVERY_ENABLED || 'true') === 'true',
  recoveryIntervalMs: Number.parseInt(process.env.CONVERSATION_RECOVERY_INTERVAL_MS || '30000', 10),
  recoveryGraceMs: Number.parseInt(process.env.CONVERSATION_RECOVERY_GRACE_MS || '60000', 10),
  // Fleet-wide admission (WP07): shared caps across replicas. The per-user
  // active-run default stays 5 (CONVERSATION_MAX_CONCURRENT_STREAMS); these
  // add global fleet bounds enforced via shared PostgreSQL admission state.
  fleetAdmissionEnabled: (process.env.CONVERSATION_FLEET_ADMISSION_ENABLED || 'true') === 'true',
  fleetMaxActiveRuns: Number.parseInt(process.env.CONVERSATION_FLEET_MAX_ACTIVE_RUNS || '50', 10),
  fleetMaxQueuedPerUser: Number.parseInt(process.env.CONVERSATION_FLEET_MAX_QUEUED_PER_USER || '5', 10),
  fleetQueueWaitMs: Number.parseInt(process.env.CONVERSATION_FLEET_QUEUE_WAIT_MS || '60000', 10),
  orphanedConversationThresholdHours: Number.parseInt(process.env.CONVERSATION_ORPHANED_THRESHOLD_HOURS || '24', 10),
  maxCloneMessages: Number.parseInt(process.env.CONVERSATION_MAX_CLONE_MESSAGES || '2000', 10),
  maxPrivateShareRecipients: Number.parseInt(process.env.CONVERSATION_MAX_PRIVATE_SHARE_RECIPIENTS || '20', 10),
  cloneInsertBatchSize: Number.parseInt(process.env.CONVERSATION_CLONE_INSERT_BATCH_SIZE || '250', 10),
  carbonFactorsJson: process.env.CONVERSATION_CARBON_FACTORS_JSON || '{}',
  carbonMethodology: process.env.CONVERSATION_CARBON_METHODOLOGY || 'tokens-factor-v1',
  carbonFactorVersion: process.env.CONVERSATION_CARBON_FACTOR_VERSION || 'unconfigured',
}));
