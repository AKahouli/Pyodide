import { registerAs } from '@nestjs/config';

/**
 * Descriptive User-Agent sent on our outbound crawl/reachability fetches.
 * Wikipedia and other sites reject requests carrying axios's default
 * `axios/<version>` User-Agent (or none) with 403 — a real, descriptive UA
 * avoids that. Shared as a single constant so the config default, the
 * crawler, and the reachability service can never drift apart.
 */
export const DEFAULT_CRAWL_USER_AGENT =
  'YellowStormBot/1.0 (+https://yellowsys.fr; workspace website indexer)';

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
  crawlMaxPages: Number.parseInt(process.env.CRAWL_MAX_PAGES || '50', 10),
  crawlMaxDepth: Number.parseInt(process.env.CRAWL_MAX_DEPTH || '2', 10),
  crawlTimeBudgetMs: Number.parseInt(process.env.CRAWL_TIME_BUDGET_MS || '10000', 10),
  crawlConcurrency: Number.parseInt(process.env.CRAWL_CONCURRENCY || '5', 10),
  crawlUserAgent: process.env.CRAWL_USER_AGENT || DEFAULT_CRAWL_USER_AGENT,
}));
