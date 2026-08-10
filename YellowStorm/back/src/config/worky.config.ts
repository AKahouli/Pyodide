import { registerAs } from '@nestjs/config';

/**
 * Worky (Chief of Staff) runtime configuration. Mirrors the per-feature
 * `registerAs` pattern used by `playbook-flow` and `conversationV2`. Values
 * are sourced from the `WORKY_*` env vars validated in `config.schema.ts`.
 */
export default registerAs('worky', () => ({
  runtimeBaseUrl: process.env.WORKY_RUNTIME_BASE_URL || 'http://worky-adk-runtime:8011',
  runtimeTimeoutMs: parseInt(process.env.WORKY_RUNTIME_TIMEOUT_MS || '120000', 10),
  serviceToken: process.env.WORKY_SERVICE_TOKEN || '',
  sseHeartbeatMs: parseInt(process.env.WORKY_SSE_HEARTBEAT_MS || '15000', 10),
  maxSseConnections: parseInt(process.env.WORKY_MAX_SSE_CONNECTIONS || '5', 10),
  defaultStorageBytes: parseInt(process.env.WORKY_DEFAULT_STORAGE_BYTES || '52428800', 10),
  idempotencyTtlHours: parseInt(process.env.WORKY_IDEMPOTENCY_TTL_HOURS || '24', 10),
  // Speech-to-text via OpenRouter (`/v1/audio/transcriptions`, base64 JSON).
  sttBaseUrl: process.env.WORKY_STT_BASE_URL || 'https://openrouter.ai/api',
  sttModel: process.env.WORKY_STT_MODEL || 'openai/whisper-large-v3-turbo',
  sttLanguage: process.env.WORKY_STT_LANGUAGE || '', // '' = auto-detect (EN/FR)
  sttTimeoutMs: parseInt(process.env.WORKY_STT_TIMEOUT_MS || '30000', 10),
  sttMaxBytes: parseInt(process.env.WORKY_STT_MAX_BYTES || '26214400', 10),
  // OpenRouter API key (bearer token).
  sttApiKey: process.env.WORKY_STT_API_KEY || '',
  // OpenRouter provider routing. e.g. 'groq' to pin Whisper to Groq (the only
  // provider that serves it). Comma-separated for an ordered fallback list.
  sttProvider: process.env.WORKY_STT_PROVIDER || '',

  // Text-to-speech via OpenRouter (`/v1/audio/speech`). Reuses the STT
  // OpenRouter base URL + API key (same account).
  ttsModel: process.env.WORKY_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview',
  ttsVoice: process.env.WORKY_TTS_VOICE || 'Kore',
  ttsFormat: process.env.WORKY_TTS_FORMAT || 'pcm', // Gemini TTS only emits pcm
  ttsProvider: process.env.WORKY_TTS_PROVIDER || '', // e.g. 'google-vertex'
  ttsTimeoutMs: parseInt(process.env.WORKY_TTS_TIMEOUT_MS || '30000', 10),
  ttsMaxChars: parseInt(process.env.WORKY_TTS_MAX_CHARS || '2000', 10),

  // Realtime voice concierge (Gemini Live, direct browser WS via ephemeral token).
  voiceApiKey: process.env.WORKY_VOICE_API_KEY || '',
  voiceModel: process.env.WORKY_VOICE_MODEL || 'gemini-3.1-flash-live-preview',
  voiceName: process.env.WORKY_VOICE_NAME || 'Kore',
  voiceWsBaseUrl:
    process.env.WORKY_VOICE_WS_BASE_URL ||
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
  voiceTokenTtlSec: parseInt(process.env.WORKY_VOICE_TOKEN_TTL_SEC || '1800', 10),
  voiceSessionStartTtlSec: parseInt(process.env.WORKY_VOICE_SESSION_START_TTL_SEC || '60', 10),

  // Electric SQL sync (manager-owned Postgres → Nest consumer).
  electricUrl: process.env.WORKY_ELECTRIC_URL || 'http://electric:3000/v1/shape',
  // Shared secret appended as `&secret=<...>` to every Electric shape request.
  electricSecret: process.env.ELECTRIC_SECRET || '',
  electricMessagesTable: process.env.WORKY_ELECTRIC_MESSAGES_TABLE || 'messages',
  electricPlansTable: process.env.WORKY_ELECTRIC_PLANS_TABLE || 'plans',
  electricPlanStepsTable: process.env.WORKY_ELECTRIC_PLAN_STEPS_TABLE || 'plan_steps',
  // Gated payload logging for the Electric consumer (row/control/applied
  // debug logs include row payloads, which may contain PII) — off by default.
  electricDebug: process.env.WORKY_ELECTRIC_DEBUG === 'true',
}));
