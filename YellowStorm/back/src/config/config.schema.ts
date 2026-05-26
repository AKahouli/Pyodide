import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
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
  MEMORY_LIMIT_MB: Joi.number().min(64).default(512),

  // Encryption
  ENCRYPTION_KEY: Joi.string().hex().length(64).when('NODE_ENV', {
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
  CEPH_S3_REGION: Joi.string().default('us-east-1'),
  CEPH_S3_BUCKET: Joi.string().default('documents'),
  CEPH_S3_ACCESS_KEY_ID: Joi.string().optional(),
  CEPH_S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  CEPH_S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  CEPH_S3_PUBLIC_URL: Joi.string().uri({ allowRelative: false }).optional(),
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
  CONVERSATION_GRPC_TIMEOUT_MS: Joi.number().min(5000).max(300000).default(120000),
  CONVERSATION_MAX_CONCURRENT_STREAMS: Joi.number().min(1).max(20).default(5),
  CONVERSATION_SSE_HEARTBEAT_MS: Joi.number().min(5000).max(60000).default(15000),
  CONVERSATION_MAX_SSE_CONNECTIONS: Joi.number().min(1).max(20).default(5),
  CONVERSATION_MAX_MESSAGE_LENGTH: Joi.number().min(1000).max(100000).default(50000),
  CONVERSATION_MAX_FILES_PER_MESSAGE: Joi.number().min(1).max(20).default(5),
  CONVERSATION_SHARE_EXPIRY_DAYS: Joi.number().min(1).max(365).default(30),
  CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES: Joi.number().min(1048576).default(52428800),

  // Conversation V2 (Manus)
  CONVERSATION_V2_GRPC_URL: Joi.string().default('localhost:50051'),
  CONVERSATION_V2_GRPC_UNARY_DEADLINE_MS: Joi.number().default(5000),
  CONVERSATION_V2_GRPC_STREAM_DEADLINE_MS: Joi.number().default(900000),
  CONVERSATION_V2_SSE_HEARTBEAT_MS: Joi.number().default(15000),
  CONVERSATION_V2_MAX_MESSAGE_LENGTH: Joi.number().default(16384),
  CONVERSATION_V2_GRPC_MAX_MESSAGE_BYTES: Joi.number().default(16 * 1024 * 1024),

  // LiteLLM
  LITELLM_API_URL: Joi.string().uri().optional(),
  LITELLM_API_KEY: Joi.string().optional(),
  LITELLM_TIMEOUT_MS: Joi.number().min(1000).max(60000).default(10000),
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
  PLAYBOOK_IDEMPOTENCY_TTL_HOURS: Joi.number().min(1).max(168).default(24),
  // Telegram
  TELEGRAM_ENABLED: Joi.boolean().default(true),
  TELEGRAM_API_BASE_URL: Joi.string().uri().default('https://api.telegram.org'),
  TELEGRAM_API_TIMEOUT_MS: Joi.number().min(1000).max(120000).default(15000),
  TELEGRAM_LINK_CODE_TTL_SECONDS: Joi.number().min(60).max(86400).default(900),
  TELEGRAM_LINK_CODE_LENGTH: Joi.number().min(6).max(32).default(8),
  TELEGRAM_WEBHOOK_RATE_LIMIT: Joi.number().min(1).max(10000).default(60),
  TELEGRAM_WEBHOOK_RATE_WINDOW_MS: Joi.number().min(1000).max(3600000).default(60000),
  TELEGRAM_MAX_REPLY_LENGTH: Joi.number().min(64).max(4096).default(3900),

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
});
