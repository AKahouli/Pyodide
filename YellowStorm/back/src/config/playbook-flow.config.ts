import { registerAs } from '@nestjs/config';

/**
 * Static playbook-flow infrastructure config. Operator-tunable toggles and
 * concurrency quotas (asyncDesign, deltaPatch, token buffer, execution lease,
 * dynamic reasoning, max-concurrent/queue/recursion/parallelism limits) moved
 * to admin-managed runtime settings: catalog.system_settings `playbook_settings`
 * (see src/modules/system/interfaces/playbook-settings.interface.ts).
 */
export default registerAs('playbook-flow', () => ({
  grpcUrl: process.env.PLAYBOOK_FLOW_GRPC_URL || 'localhost:50051',
  grpcTimeoutMs: Number.parseInt(process.env.PLAYBOOK_FLOW_GRPC_TIMEOUT_MS || '300000', 10),
  pythonWorkerPoolSize: Number.parseInt(process.env.PLAYBOOK_PYTHON_WORKER_POOL_SIZE || '8', 10),
  pythonWorkerMaxInflight: Number.parseInt(process.env.PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT || '4', 10),
  maxHitlRounds: Number.parseInt(process.env.PLAYBOOK_MAX_HITL_ROUNDS || '5', 10),
  maxToolIterations: Number.parseInt(process.env.PLAYBOOK_MAX_TOOL_ITERATIONS || '40', 10),
  graphCacheEnabled: process.env.PLAYBOOK_GRAPH_CACHE_ENABLED === 'true',
  graphCacheMaxEntries: Number.parseInt(process.env.PLAYBOOK_GRAPH_CACHE_MAX_ENTRIES || '128', 10),
  graphCacheTtlSeconds: Number.parseInt(process.env.PLAYBOOK_GRAPH_CACHE_TTL_SECONDS || '900', 10),
  idempotencyTtlHours: Number.parseInt(process.env.PLAYBOOK_IDEMPOTENCY_TTL_HOURS || '24', 10),
  smartHitlDefaultEnabled: process.env.PLAYBOOK_SMART_HITL_DEFAULT_ENABLED !== 'false',
  tokenBufferFlushIntervalMs: Number.parseInt(process.env.PLAYBOOK_TOKEN_BUFFER_FLUSH_INTERVAL_MS || '750', 10),
  tokenBufferMaxBytes: Number.parseInt(process.env.PLAYBOOK_TOKEN_BUFFER_MAX_BYTES || '4096', 10),
  tokenBufferMaxTaskBytes: Number.parseInt(process.env.PLAYBOOK_TOKEN_BUFFER_MAX_TASK_BYTES || '65536', 10),
  tokenBufferMaxActiveBuffers: Number.parseInt(process.env.PLAYBOOK_TOKEN_BUFFER_MAX_ACTIVE_BUFFERS || '1000', 10),
  executionLeaseTtlMs: Number.parseInt(process.env.PLAYBOOK_EXECUTION_LEASE_TTL_MS || '120000', 10),
  executionLeaseHeartbeatMs: Number.parseInt(process.env.PLAYBOOK_EXECUTION_LEASE_HEARTBEAT_MS || '30000', 10),
  executionStartupTimeoutMs: Number.parseInt(process.env.PLAYBOOK_EXECUTION_STARTUP_TIMEOUT_MS || '180000', 10),
  executionDispatchIntervalMs: Number.parseInt(process.env.PLAYBOOK_EXECUTION_DISPATCH_INTERVAL_MS || '1000', 10),
  queuePositionUpdateThrottleMs: Number.parseInt(process.env.PLAYBOOK_QUEUE_POSITION_UPDATE_THROTTLE_MS || '500', 10),
  mcpServerUrl: process.env.PLAYBOOK_MCP_SERVER_URL || 'http://localhost:8025/mcp',
}));
