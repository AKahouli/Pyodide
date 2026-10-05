import { registerAs } from '@nestjs/config';

export default registerAs('semanticModel', () => ({
  autoProvision: process.env.SEMANTIC_MODELS_AUTO_PROVISION === 'true',
  runtimeEnabled: process.env.SEMANTIC_MODEL_RUNTIME_ENABLED === 'true',
  runtimeWritesEnabled: process.env.SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED === 'true',
  runtimeUrl: process.env.SEMANTIC_MODEL_RUNTIME_URL || '',
  runtimeServiceKey: process.env.SEMANTIC_RUNTIME_SERVICE_KEY || '',
  runtimeRequestTimeoutMs: Number.parseInt(process.env.SEMANTIC_MODEL_RUNTIME_REQUEST_TIMEOUT_MS || '5000', 10),
  dataApiEnabled: process.env.SEMANTIC_MODEL_DATA_API_ENABLED === 'true',
  realtimeEnabled: process.env.SEMANTIC_MODEL_REALTIME_ENABLED === 'true',
  contextSearchEnabled: process.env.SEMANTIC_MODEL_CONTEXT_SEARCH_ENABLED === 'true',
  llmFallbackEnabled: process.env.SEMANTIC_MODEL_LLM_FALLBACK_ENABLED === 'true',
  host: process.env.SEMANTIC_PG_HOST || '',
  port: Number.parseInt(process.env.SEMANTIC_PG_PORT || '5432', 10),
  user: process.env.SEMANTIC_PG_USER || '',
  password: process.env.SEMANTIC_PG_PASSWORD || '',
  database: process.env.SEMANTIC_PG_DATABASE || '',
  // AGE graph instance. Unset fields fall back to the definitions database
  // (legacy single-DB deployment); setting them splits graph I/O onto the
  // dedicated AGE host (e.g. agentstore definitions + :3520 graphs).
  ageHost: process.env.SEMANTIC_AGEGRAPH_HOST || '',
  agePort: Number.parseInt(process.env.SEMANTIC_AGEGRAPH_PORT || process.env.SEMANTIC_PG_PORT || '5432', 10),
  ageUser: process.env.SEMANTIC_AGEGRAPH_USER || '',
  agePassword: process.env.SEMANTIC_AGEGRAPH_PASSWORD || '',
  ageDatabase: process.env.SEMANTIC_AGEGRAPH_DATABASE || '',
  ssl: process.env.SEMANTIC_PG_SSL === 'true',
  poolMax: Number.parseInt(process.env.SEMANTIC_PG_POOL_MAX || '10', 10),
  dataJwtSecret: process.env.SEMANTIC_DATA_JWT_SECRET || '',
  realtimeJwtSecret: process.env.SEMANTIC_REALTIME_JWT_SECRET || '',
  dataTokenTtlSeconds: Math.max(10, Number.parseInt(process.env.SEMANTIC_DATA_TOKEN_TTL_SECONDS || '60', 10)),
  dataRestUrl: process.env.SEMANTIC_DATA_REST_URL || 'http://127.0.0.1:3050',
  dataRealtimeUrl: process.env.SEMANTIC_DATA_REALTIME_URL || 'ws://yellowmind-semantic.localhost:4000',
  schema: 'semantic_model',
  ageGraph: process.env.SEMANTIC_AGE_GRAPH || 'semantic_model_graph',
  nativeSearchUrl: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_URL || 'http://localhost:8045/search_native',
  nativeSearchBatchUrl: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_BATCH_URL
    || `${process.env.SEMANTIC_MODEL_NATIVE_SEARCH_URL || 'http://localhost:8045/search_native'}/batch`,
  nativeSearchAuthToken: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_AUTH_TOKEN || '',
  nativeSearchLogQuery: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_LOG_QUERY === 'true',
  documentExtractionAgentId: process.env.SEMANTIC_MODEL_DOCUMENT_EXTRACTION_AGENT_ID || '',
  documentExtractionTimeoutMs: Number.parseInt(process.env.SEMANTIC_MODEL_DOCUMENT_EXTRACTION_TIMEOUT_MS || '180000', 10),
  // mcp-semantic-model server (record search tools bound to chat when a model is selected).
  // An empty URL disables seeding of the hidden system connector.
  mcpServerUrl: process.env.SEMANTIC_MODEL_MCP_SERVER_URL ?? 'http://localhost:8027/mcp',
  mcpIngressToken: process.env.SEMANTIC_MODEL_MCP_INGRESS_TOKEN ?? '',
}));
