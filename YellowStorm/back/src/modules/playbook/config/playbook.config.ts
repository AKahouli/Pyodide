import { registerAs } from '@nestjs/config';

export default registerAs('playbook', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  grpcTimeoutMs: parseInt(process.env.PLAYBOOK_GRPC_TIMEOUT_MS || '300000', 10),
  grpcWorkflowTimeoutMs: parseInt(process.env.PLAYBOOK_GRPC_WORKFLOW_TIMEOUT_MS || '600000', 10),
  maxSseConnections: parseInt(process.env.PLAYBOOK_MAX_SSE_CONNECTIONS || '5', 10),
  sseHeartbeatMs: parseInt(process.env.PLAYBOOK_SSE_HEARTBEAT_MS || '15000', 10),
  maxComponentsPerTask: parseInt(process.env.PLAYBOOK_MAX_COMPONENTS_PER_TASK || '200', 10),
  maxComponentDataBytes: parseInt(process.env.PLAYBOOK_MAX_COMPONENT_DATA_BYTES || '500000', 10),
  maxConcurrentSteps: parseInt(process.env.PLAYBOOK_MAX_CONCURRENT_STEPS || '5', 10),
  promptRewriteSystemPrompt: process.env.PLAYBOOK_PROMPT_REWRITE_SYSTEM_PROMPT || [
    'You rewrite workflow prompts for a playbook builder.',
    'Improve clarity, specificity, structure, and actionability while preserving the user\'s intent.',
    'Return only the rewritten prompt as plain text, with no preamble, no bullets, and no quotes.',
  ].join(' '),
}));
