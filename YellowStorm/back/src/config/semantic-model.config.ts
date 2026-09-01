import { registerAs } from '@nestjs/config';

export default registerAs('semanticModel', () => ({
  enabled: process.env.SEMANTIC_MODELS_ENABLED === 'true',
  autoProvision: process.env.SEMANTIC_MODELS_AUTO_PROVISION === 'true',
  host: process.env.SEMANTIC_PG_HOST || '',
  port: Number.parseInt(process.env.SEMANTIC_PG_PORT || '5432', 10),
  user: process.env.SEMANTIC_PG_USER || '',
  password: process.env.SEMANTIC_PG_PASSWORD || '',
  database: process.env.SEMANTIC_PG_DATABASE || '',
  ssl: process.env.SEMANTIC_PG_SSL === 'true',
  poolMax: Number.parseInt(process.env.SEMANTIC_PG_POOL_MAX || '10', 10),
  schema: 'semantic_model',
  ageGraph: process.env.SEMANTIC_AGE_GRAPH || 'semantic_model_graph',
  nativeSearchUrl: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_URL || 'http://localhost:8045/search_native',
  nativeSearchBatchUrl: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_BATCH_URL
    || `${process.env.SEMANTIC_MODEL_NATIVE_SEARCH_URL || 'http://localhost:8045/search_native'}/batch`,
  nativeSearchAuthToken: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_AUTH_TOKEN || '',
  nativeSearchLogQuery: process.env.SEMANTIC_MODEL_NATIVE_SEARCH_LOG_QUERY === 'true',
  evidenceSearchTimeoutMs: Number.parseInt(process.env.SEMANTIC_MODEL_EVIDENCE_SEARCH_TIMEOUT_MS || '180000', 10),
  evidenceSearchConcurrency: Math.max(1, Number.parseInt(process.env.SEMANTIC_MODEL_EVIDENCE_SEARCH_CONCURRENCY || '4', 10)),
  ontologyTimeoutMs: Number.parseInt(process.env.SEMANTIC_MODEL_ONTOLOGY_TIMEOUT_MS || '0', 10),
  mappingTimeoutMs: Number.parseInt(process.env.SEMANTIC_MODEL_MAPPING_TIMEOUT_MS || '0', 10),
}));
