export const AI_PROXY_DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** Chat/stream timeout — longer than litellm.timeoutMs (health/embeddings, max 60s). */
export const AI_PROXY_REQUEST_TIMEOUT_MS = 300_000;

export const AI_PROXY_CHAT_ENDPOINT = 'ai-proxy.chat-completions';

export const AI_PROXY_DEFAULT_RATE_LIMIT_PER_USER = 60;
export const AI_PROXY_DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
