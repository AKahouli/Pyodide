import { registerAs } from '@nestjs/config';

export default registerAs('indexing', () => ({
  apiUrl: process.env.INDEXING_API_URL || 'http://localhost:4000',
  apiKey: process.env.INDEXING_API_KEY || '',
  apiAdk: process.env.API_ADK_URL || '',
  communityGraphUrl: process.env.COMMUNITY_GRAPH_URL || 'http://localhost:8000',
  username: process.env.INDEXING_API_USERNAME || '',
  password: process.env.INDEXING_API_PASSWORD || '',
  vectorstoreApiKey: process.env.VECTORSTORE_API_KEY || '',
  adkApiKey: process.env.ADK_API_KEY || '',
  batchSize: Number.parseInt(process.env.INDEXING_BATCH_SIZE || '10', 10),
  processingIntervalMs: Number.parseInt(process.env.INDEXING_INTERVAL_MS || '30000', 10),
  timeoutMs: Number.parseInt(process.env.INDEXING_TIMEOUT_MS || '3600000', 10), // 1 hour
  enabled: process.env.INDEXING_ENABLED !== 'false',
  urlToPdfApiUrl: process.env.URL_TO_PDF_API_URL || 'http://localhost:5000',
  urlToPdfApiKey: process.env.URL_TO_PDF_API_KEY || '',
}));
