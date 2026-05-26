import { registerAs } from '@nestjs/config';

export default registerAs('playbook-flow', () => ({
  grpcUrl: process.env.PLAYBOOK_FLOW_GRPC_URL || 'localhost:50051',
  grpcTimeoutMs: parseInt(process.env.PLAYBOOK_FLOW_GRPC_TIMEOUT_MS || '300000', 10),
  maxConcurrentPerUser: parseInt(process.env.PLAYBOOK_MAX_CONCURRENT_PER_USER || '10', 10),
  executionQueueMaxDepth: parseInt(process.env.PLAYBOOK_EXECUTION_QUEUE_MAX_DEPTH || '50', 10),
  maxParallelismPerExecution: parseInt(process.env.PLAYBOOK_MAX_PARALLELISM_PER_EXECUTION || '5', 10),
  recursionLimitDefault: parseInt(process.env.PLAYBOOK_RECURSION_LIMIT_DEFAULT || '25', 10),
  recursionLimitMax: parseInt(process.env.PLAYBOOK_RECURSION_LIMIT_MAX || '50', 10),
  pythonWorkerPoolSize: parseInt(process.env.PLAYBOOK_PYTHON_WORKER_POOL_SIZE || '8', 10),
  pythonWorkerMaxInflight: parseInt(process.env.PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT || '4', 10),
  idempotencyTtlHours: parseInt(process.env.PLAYBOOK_IDEMPOTENCY_TTL_HOURS || '24', 10),
}));
