import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  GOVERNED_CONVERSATIONS_ENABLED: Joi.boolean().default(false),
  GOVERNANCE_SCOPE_AUDIENCE_ENABLED: Joi.boolean().default(false),
  GOVERNED_SCOPE_CAROUSEL_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_GOVERNANCE_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_WORKSPACE_EVENTS_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_GOVERNANCE_EVENT_CONSUMER_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_RECONCILIATION_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_OUTBOX_DISPATCH_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_VALIDITY_INTELLIGENCE_ENABLED: Joi.boolean().default(false),
  DATA_ROOM_KNOWLEDGE_ASSESSMENT_ENABLED: Joi.boolean().default(false),
  // Application
  APP_NAME: Joi.string().default('YelloStorm'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),
  BACKEND_URL: Joi.string().uri().optional(),
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  GITHUB_CALLBACK_URL: Joi.string().uri().optional(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),

  // Agent memory cards Postgres (external "thematic_memory" DB)
  MEMORY_PG_HOST: Joi.string().optional(),
  MEMORY_PG_PORT: Joi.number().default(5432),
  MEMORY_PG_USER: Joi.string().optional(),
  MEMORY_PG_PASSWORD: Joi.string().optional(),
  MEMORY_PG_DB: Joi.string().optional(),
  MEMORY_PG_SSL: Joi.boolean().optional(),
  MEMORY_LIMIT_MB: Joi.number().min(64).default(512),

  // App-owned Postgres (agents datastore — Drizzle)
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().default('postgres'),
  POSTGRES_PASSWORD: Joi.string().allow('').default('postgres'),
  POSTGRES_DB: Joi.string().default('yellostorm'),
  POSTGRES_SSL: Joi.boolean().default(false),
  POSTGRES_MAX_POOL_SIZE: Joi.number().min(1).max(100).default(10),
  POSTGRES_IDLE_TIMEOUT: Joi.number().min(0).default(30000),
  POSTGRES_CONNECT_TIMEOUT: Joi.number().min(1000).default(10000),
  POSTGRES_STATEMENT_TIMEOUT: Joi.number().min(1000).max(300000).default(30000),
  POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT: Joi.number().min(1000).max(300000).default(30000),
  POSTGRES_KEEPALIVE: Joi.boolean().default(true),
  REPLICA_ID: Joi.string().max(100).optional(),
  CONVERSATION_MAX_CLONE_MESSAGES: Joi.number().min(1).max(10000).default(2000),
  CONVERSATION_MAX_PRIVATE_SHARE_RECIPIENTS: Joi.number().min(1).max(20).default(20),
  CONVERSATION_CLONE_INSERT_BATCH_SIZE: Joi.number().min(1).max(1000).default(250),

  // Semantic Model PostgreSQL / Apache AGE
  SEMANTIC_MODELS_ENABLED: Joi.boolean().default(false),
  SEMANTIC_MODELS_AUTO_PROVISION: Joi.boolean().default(false),
  SEMANTIC_PG_HOST: Joi.string().when('SEMANTIC_MODELS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  SEMANTIC_PG_PORT: Joi.number().min(1).max(65535).default(5432),
  SEMANTIC_PG_USER: Joi.string().when('SEMANTIC_MODELS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  SEMANTIC_PG_PASSWORD: Joi.string().allow('').optional(),
  SEMANTIC_PG_DATABASE: Joi.string().when('SEMANTIC_MODELS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  SEMANTIC_PG_SSL: Joi.boolean().default(false),
  SEMANTIC_PG_POOL_MAX: Joi.number().min(1).max(50).default(10),
  SEMANTIC_AGE_GRAPH: Joi.string()
    .pattern(/^[a-z][a-z0-9_]{0,62}$/)
    .default('semantic_model_graph'),

  // Encryption
  ENCRYPTION_KEY: Joi.string()
    .hex()
    .length(64)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),

  // AI Service
  AI_SERVICE_URL: Joi.string().uri().optional(),
  AI_API_KEY: Joi.string().optional(),

  // CORS
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),
  // Express trust proxy: false|0|empty, hop count, true, or CIDR/name list
  TRUST_PROXY: Joi.string().allow('').default(''),

  // MongoDB
  MONGODB_URI: Joi.string().default('mongodb://localhost:27017/yellostorm'),
  MONGODB_MAX_POOL_SIZE: Joi.number().min(1).max(100).default(10),
  MONGODB_MIN_POOL_SIZE: Joi.number().min(0).max(50).default(2),
  MONGODB_SERVER_SELECTION_TIMEOUT: Joi.number().min(1000).default(5000),
  MONGODB_SOCKET_TIMEOUT: Joi.number().min(1000).default(45000),
  MONGODB_CONNECT_TIMEOUT: Joi.number().min(1000).default(10000),
  MONGODB_RETRY_WRITES: Joi.boolean().default(true),
  MONGODB_RETRY_READS: Joi.boolean().default(true),
  MONGODB_MAX_IDLE_TIME: Joi.number().min(0).default(60000),
  MONGODB_HEARTBEAT_FREQUENCY: Joi.number().min(500).default(10000),

  // MongoDB Reconnection
  MONGODB_RECONNECT_ENABLED: Joi.boolean().default(true),
  MONGODB_RECONNECT_INITIAL_DELAY: Joi.number().min(100).default(1000),
  MONGODB_RECONNECT_MAX_DELAY: Joi.number().min(1000).default(30000),
  MONGODB_RECONNECT_MAX_ATTEMPTS: Joi.number().min(0).default(0),
  MONGODB_RECONNECT_MULTIPLIER: Joi.number().min(1).max(10).default(2),

  // Ceph S3 Storage
  CEPH_S3_ENDPOINT: Joi.string().uri({ allowRelative: false }).optional(),
  CEPH_ENDPOINT: Joi.string().uri({ allowRelative: false }).optional(),
  CEPH_S3_REGION: Joi.string().default('us-east-1'),
  CEPH_REGION: Joi.string().optional(),
  CEPH_S3_BUCKET: Joi.string().default('documents'),
  CEPH_BUCKET_NAME: Joi.string().optional(),
  CEPH_S3_ACCESS_KEY_ID: Joi.string().optional(),
  CEPH_ACCESS_KEY_ID: Joi.string().optional(),
  CEPH_S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  CEPH_SECRET_ACCESS_KEY: Joi.string().optional(),
  CEPH_S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  CEPH_S3_PUBLIC_URL: Joi.string().uri({ allowRelative: false }).optional(),
  CEPH_PUBLIC_URL: Joi.string().uri({ allowRelative: false }).optional(),
  STORAGE_MAX_FILE_SIZE_MB: Joi.number().min(1).max(500).default(50),
  STORAGE_MAX_FILES_PER_UPLOAD: Joi.number().min(1).max(50).default(10),
  STORAGE_SAS_EXPIRY_MINUTES: Joi.number().min(1).max(10080).default(60),
  STORAGE_ALLOWED_MIME_TYPES: Joi.string().optional(),
  STORAGE_HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  STORAGE_HEALTH_CHECK_INTERVAL_MS: Joi.number().min(10000).max(3600000).default(60000),
  STORAGE_RECONNECT_ENABLED: Joi.boolean().default(true),
  STORAGE_RECONNECT_INITIAL_DELAY_MS: Joi.number().min(100).default(1000),
  STORAGE_RECONNECT_MAX_DELAY_MS: Joi.number().min(1000).default(30000),
  STORAGE_RECONNECT_MAX_ATTEMPTS: Joi.number().min(0).default(0),
  STORAGE_RECONNECT_MULTIPLIER: Joi.number().min(1).max(10).default(2),

  // JWT
  JWT_SECRET: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),
  JWT_ISSUER: Joi.string().default('yellostorm'),
  JWT_AUDIENCE: Joi.string().default('yellostorm-api'),

  // Auth
  AUTH_BCRYPT_ROUNDS: Joi.number().min(10).max(14).default(12),
  AUTH_EMAIL_VERIFICATION_EXPIRY_HOURS: Joi.number().min(1).max(168).default(24),
  AUTH_MAX_SESSIONS_PER_USER: Joi.number().min(1).max(50).default(10),
  AUTH_REFRESH_TOKEN_COOKIE_NAME: Joi.string().default('refresh_token'),
  AUTH_COOKIE_SAME_SITE: Joi.string().valid('strict', 'lax', 'none').default('strict'),

  // Third-party API key (static key for the public /agents endpoint, X-API-Key header)
  THIRD_PARTY_API_KEY: Joi.string().min(8).optional(),

  // Microsoft OAuth
  MICROSOFT_CLIENT_ID: Joi.string().optional(),
  MICROSOFT_CLIENT_SECRET: Joi.string().optional(),
  MICROSOFT_TENANT_ID: Joi.string().default('common'),
  MICROSOFT_REDIRECT_URI: Joi.string().uri().optional(),

  // Email Provider
  EMAIL_PROVIDER: Joi.string().valid('smtp', 'outlook').default('smtp'),

  // Outlook / Azure AD
  AZURE_AD_CLIENT_ID: Joi.string().optional(),
  AZURE_AD_CLIENT_SECRET: Joi.string().optional(),
  AZURE_AD_TENANT_ID: Joi.string().optional(),
  AZURE_AD_INSTANCE: Joi.string().uri().default('https://login.microsoftonline.com'),
  OUTLOOK_SENDER_EMAIL: Joi.string().email().optional(),

  // Email (SMTP)
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().min(1).max(65535).default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  EMAIL_FROM_NAME: Joi.string().default('YelloStorm'),
  EMAIL_FROM_ADDRESS: Joi.string().email().default('noreply@yellostorm.com'),
  EMAIL_POOL_ENABLED: Joi.boolean().default(true),
  EMAIL_POOL_MAX_CONNECTIONS: Joi.number().min(1).max(50).default(5),
  EMAIL_POOL_MAX_MESSAGES: Joi.number().min(1).max(1000).default(100),
  EMAIL_RETRY_ENABLED: Joi.boolean().default(true),
  EMAIL_RETRY_MAX_ATTEMPTS: Joi.number().min(1).max(10).default(3),
  EMAIL_RETRY_INITIAL_DELAY: Joi.number().min(100).default(1000),
  EMAIL_RETRY_MAX_DELAY: Joi.number().min(1000).default(10000),
  EMAIL_RETRY_MULTIPLIER: Joi.number().min(1).max(5).default(2),
  EMAIL_CONNECTION_TIMEOUT: Joi.number().min(1000).default(10000),
  EMAIL_SOCKET_TIMEOUT: Joi.number().min(1000).default(30000),
  EMAIL_HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  EMAIL_HEALTH_CHECK_INTERVAL_MS: Joi.number().min(10000).max(3600000).default(60000),
  EMAIL_RECONNECT_ENABLED: Joi.boolean().default(true),
  EMAIL_RECONNECT_INITIAL_DELAY_MS: Joi.number().min(100).default(1000),
  EMAIL_RECONNECT_MAX_DELAY_MS: Joi.number().min(1000).default(30000),
  EMAIL_RECONNECT_MAX_ATTEMPTS: Joi.number().min(0).default(0),
  EMAIL_RECONNECT_MULTIPLIER: Joi.number().min(1).max(10).default(2),

  // Health
  HEALTH_HISTORY_ENABLED: Joi.boolean().default(true),
  HEALTH_CHECK_INTERVAL_SECONDS: Joi.number().min(10).max(3600).default(30),
  HEALTH_RETENTION_HOURS: Joi.number().min(1).max(168).default(24),

  // Conversation
  CONVERSATION_GRPC_URL: Joi.string().default('localhost:50051'),
  CONVERSATION_GRPC_TIMEOUT_MS: Joi.number().min(5000).max(1000000).default(300000),
  CONVERSATION_MAX_CONCURRENT_STREAMS: Joi.number().min(1).max(50).default(5),
  CONVERSATION_SSE_HEARTBEAT_MS: Joi.number().min(5000).max(60000).default(15000),
  CONVERSATION_MAX_SSE_CONNECTIONS: Joi.number().min(1).max(20).default(5),
  CONVERSATION_MAX_MESSAGE_LENGTH: Joi.number().min(1000).max(100000).default(50000),
  CONVERSATION_MAX_FILES_PER_MESSAGE: Joi.number().min(1).max(20).default(5),
  CONVERSATION_SHARE_EXPIRY_DAYS: Joi.number().min(1).max(365).default(30),
  CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES: Joi.number().min(1048576).default(52428800),

  // Shared gRPC channel security (conversation, a2a-admin, playbook-flow all
  // dial the same AI service, so these are one shared cert + key).
  CONVERSATION_GRPC_API_KEY: Joi.string().optional(),
  CONVERSATION_GRPC_TLS_MODE: Joi.string().valid('insecure', 'tls').default('insecure'),
  CONVERSATION_GRPC_TLS_CA_CERT_PATH: Joi.string().optional(),
  CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE: Joi.string().optional(),
  CONVERSATION_GRPC_REQUIRE_TLS: Joi.boolean().default(false),

  // Conversation V2 (Manus)
  CONVERSATION_V2_GRPC_URL: Joi.string().default('localhost:50051'),
  CONVERSATION_V2_GRPC_UNARY_DEADLINE_MS: Joi.number().default(5000),
  CONVERSATION_V2_GRPC_STREAM_DEADLINE_MS: Joi.number().default(900000),
  CONVERSATION_V2_SSE_HEARTBEAT_MS: Joi.number().default(15000),
  CONVERSATION_V2_MAX_MESSAGE_LENGTH: Joi.number().default(16384),
  CONVERSATION_V2_GRPC_MAX_MESSAGE_BYTES: Joi.number().default(16 * 1024 * 1024),
  CONVERSATION_V2_MAX_CONCURRENT_STREAMS: Joi.number().min(1).default(5),
  CONVERSATION_V2_MAX_SSE_CONNECTIONS: Joi.number().min(1).default(5),
  CONVERSATION_V2_GRPC_IDLE_TIMEOUT_MS: Joi.number().min(1000).default(900000),
  CONVERSATION_V2_LIVE_TAIL_POLL_MS: Joi.number().min(100).default(1000),

  // Conversation V2 gRPC channel security (separate AI service → own cert + key).
  CONVERSATION_V2_GRPC_API_KEY: Joi.string().optional(),
  CONVERSATION_V2_GRPC_TLS_MODE: Joi.string().valid('insecure', 'tls').default('insecure'),
  CONVERSATION_V2_GRPC_TLS_CA_CERT_PATH: Joi.string().optional(),
  CONVERSATION_V2_GRPC_TLS_SERVER_NAME_OVERRIDE: Joi.string().optional(),
  CONVERSATION_V2_GRPC_REQUIRE_TLS: Joi.boolean().default(false),
  APP_BUILDER_DEPLOY_BASE_URL: Joi.string().uri().optional(),
  APP_BUILDER_DEPLOY_TOKEN: Joi.string().min(1).optional(),
  APP_BUILDER_DEPLOY_TIMEOUT_MS: Joi.number().min(30_000).default(600_000),
  APP_BUILDER_DEPLOY_INITIAL_STATUS_DELAY_MS: Joi.number().min(0).default(15_000),
  APP_BUILDER_DEPLOY_STATUS_POLL_INTERVAL_MS: Joi.number().min(1_000).default(15_000),
  APP_BUILDER_DEPLOYED_APPS_PATH_PREFIX: Joi.string().default('/apps'),

  // App Builder runtime — MCP + Broker on YellowStorm (see app-runtime/README.md).
  APP_RUNTIME_MCP_ENABLED: Joi.boolean().default(true),
  APP_RUNTIME_MCP_URL: Joi.string().uri().optional(),
  APP_RUNTIME_PUBLIC_BASE_URL: Joi.string().uri().optional(),
  APP_RUNTIME_LEGACY_TOOL_INVOKE: Joi.boolean().default(true),
  APP_RUNTIME_TICKET_TTL_MS: Joi.number().min(1_000).default(60_000),
  APP_RUNTIME_HEARTBEAT_TIMEOUT_MS: Joi.number().min(5_000).default(45_000),
  APP_RUNTIME_TOOL_TIMEOUT_MS: Joi.number().min(1_000).max(600_000).default(180_000),
  APP_RUNTIME_MUTATION_WAIT_MS: Joi.number().min(1_000).default(30_000),
  APP_BUILDER_STARTER_REVISION_ID: Joi.string().optional(),
  APP_BUILDER_STARTER_MANIFEST_KEY: Joi.string().optional(),

  // Persistent App Data (PostgreSQL tenant schemas — see app-data/README.md).
  APP_DATA_ENABLED: Joi.boolean().default(false),
  APP_DATA_MCP_ENABLED: Joi.boolean().default(false),
  APP_DATA_PUBLIC_API_ENABLED: Joi.boolean().default(false),
  APP_DATA_DATA_TAB_ENABLED: Joi.boolean().default(false),
  APP_DATA_PUBLIC_BASE_URL: Joi.string().uri().optional(),
  APP_DATA_PUBLIC_BASE_URL_PROD: Joi.string().uri().optional(),
  APP_DATA_MCP_URL: Joi.string().uri().optional(),
  APP_DATA_MAX_TABLES: Joi.number().min(1).max(256).default(32),
  APP_DATA_MAX_COLUMNS: Joi.number().min(1).max(256).default(64),
  APP_DATA_MAX_ROW_BODY_BYTES: Joi.number().min(1024).max(1_048_576).default(65_536),
  APP_DATA_DEFAULT_PAGE_SIZE: Joi.number().min(1).max(500).default(50),
  APP_DATA_MAX_PAGE_SIZE: Joi.number().min(1).max(1000).default(200),
  APP_DATA_PUBLIC_RATE_LIMIT_PER_MINUTE: Joi.number().min(1).max(10_000).default(120),
  APP_DATA_STATEMENT_TIMEOUT_MS: Joi.number().min(1000).max(300_000).default(30_000),
  APP_DATA_END_USER_AUTH_ENABLED: Joi.boolean().default(true),
  APP_DATA_END_USER_JWT_TTL: Joi.string().default('7d'),
  APP_DATA_END_USER_BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),

  // LiteLLM
  LITELLM_API_URL: Joi.string().uri().optional(),
  LITELLM_API_KEY: Joi.string().optional(),
  LITELLM_TIMEOUT_MS: Joi.number().min(1000).max(60000).default(10000),
  EMBEDDING_MODEL: Joi.string().default('qwen3-embedding'),
  EMBEDDING_DIMENSION: Joi.number().default(2560),
  LITELLM_HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  LITELLM_HEALTH_CHECK_INTERVAL_MS: Joi.number().min(10000).max(3600000).default(60000),
  LITELLM_RECONNECT_ENABLED: Joi.boolean().default(true),
  LITELLM_RECONNECT_INITIAL_DELAY_MS: Joi.number().min(100).default(1000),
  LITELLM_RECONNECT_MAX_DELAY_MS: Joi.number().min(1000).default(30000),
  LITELLM_RECONNECT_MAX_ATTEMPTS: Joi.number().min(0).default(0),
  LITELLM_RECONNECT_MULTIPLIER: Joi.number().min(1).max(10).default(2),

  // Playbook
  PLAYBOOK_PROMPT_REWRITE_SYSTEM_PROMPT: Joi.string().optional(),

  // Playbook Flow
  PLAYBOOK_FLOW_GRPC_URL: Joi.string().default('localhost:50051'),
  PLAYBOOK_FLOW_GRPC_TIMEOUT_MS: Joi.number().min(5000).max(600000).default(300000),
  PLAYBOOK_MAX_CONCURRENT_PER_USER: Joi.number().min(1).max(100).default(3),
  PLAYBOOK_EXECUTION_QUEUE_MAX_DEPTH: Joi.number().min(1).max(500).default(50),
  PLAYBOOK_MAX_PARALLELISM_PER_EXECUTION: Joi.number().min(1).max(20).default(5),
  PLAYBOOK_RECURSION_LIMIT_DEFAULT: Joi.number().min(1).max(200).default(25),
  PLAYBOOK_RECURSION_LIMIT_MAX: Joi.number().min(1).max(500).default(50),
  PLAYBOOK_PYTHON_WORKER_POOL_SIZE: Joi.number().min(1).max(100).default(8),
  PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT: Joi.number().min(1).max(20).default(4),
  PLAYBOOK_MAX_HITL_ROUNDS: Joi.number().min(0).max(100).default(5),
  PLAYBOOK_MAX_TOOL_ITERATIONS: Joi.number().min(1).max(500).default(40),
  PLAYBOOK_GRAPH_CACHE_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_GRAPH_CACHE_MAX_ENTRIES: Joi.number().min(1).max(10000).default(128),
  PLAYBOOK_GRAPH_CACHE_TTL_SECONDS: Joi.number().min(1).max(86400).default(900),
  PLAYBOOK_IDEMPOTENCY_TTL_HOURS: Joi.number().min(1).max(168).default(24),
  PLAYBOOK_DELTA_PATCH_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_BASE_READ_SPLIT_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_SMART_HITL_DEFAULT_ENABLED: Joi.boolean().default(true),
  PLAYBOOK_TOKEN_BUFFER_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_TOKEN_BUFFER_FLUSH_INTERVAL_MS: Joi.number().min(100).max(5000).default(750),
  PLAYBOOK_TOKEN_BUFFER_MAX_BYTES: Joi.number().min(512).max(65536).default(4096),
  PLAYBOOK_TOKEN_BUFFER_MAX_TASK_BYTES: Joi.number().min(1024).max(1048576).default(65536),
  PLAYBOOK_TOKEN_BUFFER_MAX_ACTIVE_BUFFERS: Joi.number().min(1).max(10000).default(1000),
  PLAYBOOK_EXECUTION_LEASE_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_EXECUTION_LEASE_TTL_MS: Joi.number().min(1000).max(900000).default(120000),
  PLAYBOOK_EXECUTION_LEASE_HEARTBEAT_MS: Joi.number().min(500).max(300000).default(30000),
  PLAYBOOK_EXECUTION_STARTUP_TIMEOUT_MS: Joi.number().min(1000).max(1800000).default(180000),
  PLAYBOOK_EXECUTION_DISPATCH_INTERVAL_MS: Joi.number().min(100).max(60000).default(1000),
  PLAYBOOK_QUEUE_POSITION_UPDATE_THROTTLE_MS: Joi.number().min(0).max(10000).default(500),
  PLAYBOOK_MAX_CONCURRENT_GLOBAL_EXECUTIONS: Joi.number().min(1).max(500).default(50),
  PLAYBOOK_MAX_CONCURRENT_PER_FLOW: Joi.number().min(1).max(100).default(5),
  PLAYBOOK_MAX_CONCURRENT_PER_PROVIDER: Joi.number().min(1).max(500).default(25),
  PLAYBOOK_MAX_CONCURRENT_PER_MODEL: Joi.number().min(1).max(500).default(10),
  PLAYBOOK_DYNAMIC_REASONING_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_ASYNC_DESIGN_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_MCP_ASSISTANT_ENABLED: Joi.boolean().default(false),
  PLAYBOOK_MCP_SERVER_URL: Joi.string().uri().default('http://localhost:8025/mcp'),
  PLAYBOOK_MCP_INGRESS_TOKEN: Joi.string().allow('').default(''),
  PLAYBOOK_MAX_CONCURRENT_GLOBAL_DESIGN_OPERATIONS: Joi.number().min(1).max(100).default(10),
  PLAYBOOK_MAX_CONCURRENT_USER_DESIGN_OPERATIONS: Joi.number().min(1).max(50).default(3),
  // Telegram
  TELEGRAM_ENABLED: Joi.boolean().default(true),
  TELEGRAM_API_BASE_URL: Joi.string().uri().default('https://api.telegram.org'),
  TELEGRAM_API_TIMEOUT_MS: Joi.number().min(1000).max(120000).default(15000),
  TELEGRAM_LINK_CODE_TTL_SECONDS: Joi.number().min(60).max(86400).default(900),
  TELEGRAM_LINK_CODE_LENGTH: Joi.number().min(6).max(32).default(8),
  TELEGRAM_WEBHOOK_RATE_LIMIT: Joi.number().min(1).max(10000).default(60),
  TELEGRAM_WEBHOOK_RATE_WINDOW_MS: Joi.number().min(1000).max(3600000).default(60000),
  TELEGRAM_MAX_REPLY_LENGTH: Joi.number().min(64).max(4096).default(3900),

  // WhatsApp
  WHATSAPP_ENABLED: Joi.boolean().default(true),
  WHATSAPP_MAX_REPLY_LENGTH: Joi.number().min(64).max(4096).default(4000),
  WHATSAPP_PAIRING_TIMEOUT_MS: Joi.number().min(60000).max(1800000).default(300000),
  WHATSAPP_RECONNECT_INITIAL_DELAY_MS: Joi.number().min(500).max(60000).default(1000),
  WHATSAPP_RECONNECT_MAX_DELAY_MS: Joi.number().min(1000).max(600000).default(120000),
  WHATSAPP_RECONNECT_MAX_ATTEMPTS: Joi.number().min(0).max(50).default(10),
  WHATSAPP_CONNECTIVITY_PROBE_TIMEOUT_MS: Joi.number().min(1000).max(60000).default(10000),
  WHATSAPP_PROCESSING_TIMEOUT_MS: Joi.number().min(30000).max(600000).default(180000),
  WHATSAPP_MAX_INBOUND_PER_MINUTE: Joi.number().min(1).max(300).default(30),
  WHATSAPP_FALLBACK_REPLY: Joi.string()
    .max(500)
    .default('I could not generate a response for this message.'),
  WHATSAPP_CIRCUIT_BREAKER_FAILURE_THRESHOLD: Joi.number().min(1).max(20).default(3),
  WHATSAPP_CIRCUIT_BREAKER_COOLDOWN_MS: Joi.number().min(5000).max(300000).default(60000),

  // Logging Persistence
  LOGGING_MONGODB_URI: Joi.string().optional(),
  LOGGING_BUFFER_SIZE: Joi.number().min(10).max(10000).default(100),
  LOGGING_FLUSH_INTERVAL_MS: Joi.number().min(1000).max(60000).default(5000),
  LOGGING_TTL_DAYS: Joi.number().min(1).max(365).default(30),
  LOGGING_PERSISTENCE_ENABLED: Joi.boolean().default(true),
  LOGGING_DEFAULT_SAVE: Joi.boolean().default(true),
  LOGGING_DEFAULT_DISPLAY: Joi.boolean().default(true),
  LOGGING_MAX_POOL_SIZE: Joi.number().min(1).max(10).default(3),
  LOGGING_DISPLAY_ONLY_CONTEXTS: Joi.string().optional(),

  // Worky (Chief of Staff) — Part 1
  WORKY_RUNTIME_BASE_URL: Joi.string().uri().default('http://worky-adk-runtime:8011'),
  WORKY_RUNTIME_TIMEOUT_MS: Joi.number().min(1000).max(300000).default(120000),
  WORKY_SERVICE_TOKEN: Joi.string().min(8).optional(),
  WORKY_SSE_HEARTBEAT_MS: Joi.number().min(5000).max(60000).default(15000),
  WORKY_MAX_SSE_CONNECTIONS: Joi.number().min(1).max(20).default(5),
  WORKY_DEFAULT_STORAGE_BYTES: Joi.number().min(1048576).default(52428800),
  WORKY_IDEMPOTENCY_TTL_HOURS: Joi.number().min(1).max(168).default(24),

  // Worky — speech-to-text via OpenRouter (OpenAI-compatible transcriptions)
  WORKY_STT_BASE_URL: Joi.string().uri().default('https://openrouter.ai/api'),
  WORKY_STT_MODEL: Joi.string().default('openai/whisper-large-v3-turbo'),
  // Leave empty to let Whisper auto-detect (handles EN + FR). Set to 'en' or
  // 'fr' to pin a single language for slightly lower latency / fewer surprises.
  WORKY_STT_LANGUAGE: Joi.string().allow('').default(''),
  WORKY_STT_TIMEOUT_MS: Joi.number().min(1000).max(120000).default(30000),
  WORKY_STT_MAX_BYTES: Joi.number().min(65536).default(26214400),
  // OpenRouter API key (bearer token).
  WORKY_STT_API_KEY: Joi.string().allow('').default(''),
  // OpenRouter provider routing for STT (e.g. 'groq'). Comma-separated list
  // allowed. Empty = let OpenRouter choose.
  WORKY_STT_PROVIDER: Joi.string().allow('').default(''),

  // Worky — text-to-speech via OpenRouter (reuses WORKY_STT_BASE_URL + key)
  WORKY_TTS_MODEL: Joi.string().default('google/gemini-3.1-flash-tts-preview'),
  WORKY_TTS_VOICE: Joi.string().default('Kore'),
  WORKY_TTS_FORMAT: Joi.string().default('pcm'),
  WORKY_TTS_PROVIDER: Joi.string().allow('').default(''),
  WORKY_TTS_TIMEOUT_MS: Joi.number().min(1000).max(120000).default(30000),
  WORKY_TTS_MAX_CHARS: Joi.number().min(1).max(20000).default(2000),

  // Worky — realtime voice concierge (Gemini Live, ephemeral-token direct WS)
  WORKY_VOICE_API_KEY: Joi.string().allow('').default(''),
  WORKY_VOICE_MODEL: Joi.string().default('gemini-3.1-flash-live-preview'),
  WORKY_VOICE_NAME: Joi.string().default('Kore'),
  WORKY_VOICE_WS_BASE_URL: Joi.string()
    .uri({ scheme: ['wss'] })
    .default(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
    ),
  WORKY_VOICE_TOKEN_TTL_SEC: Joi.number().min(60).max(3600).default(1800),
  WORKY_VOICE_SESSION_START_TTL_SEC: Joi.number().min(30).max(600).default(60),

  // Worky - Electric SQL projection sync
  WORKY_ELECTRIC_URL: Joi.string().uri().default('http://electric:3000/v1/shape'),
  ELECTRIC_SECRET: Joi.string().allow('').default(''),
  WORKY_ELECTRIC_MESSAGES_TABLE: Joi.string().default('messages'),
  WORKY_ELECTRIC_SESSIONS_TABLE: Joi.string().default('sessions'),
  WORKY_ELECTRIC_PLANS_TABLE: Joi.string().default('plans'),
  WORKY_ELECTRIC_PLAN_STEPS_TABLE: Joi.string().default('plan_steps'),
  WORKY_ELECTRIC_MESSAGE_COMPONENTS_TABLE: Joi.string().default('message_components'),
  WORKY_ELECTRIC_PLAN_STEP_COMPONENTS_TABLE: Joi.string().default('plan_step_components'),
  WORKY_ELECTRIC_PLAN_STEP_ARTIFACTS_TABLE: Joi.string().default('plan_step_artifacts'),
  WORKY_ELECTRIC_DEBUG: Joi.boolean().default(false),
});
