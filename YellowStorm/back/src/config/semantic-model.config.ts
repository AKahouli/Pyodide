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
}));
