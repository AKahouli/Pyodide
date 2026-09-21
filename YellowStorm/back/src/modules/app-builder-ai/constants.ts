export const APP_BUILDER_AI_SETTINGS_KEY = 'app_builder_ai_settings';

export interface AppBuilderAiSettings {
  /** When false, App Builder preview/end-user AI proxy traffic is rejected. */
  enabled: boolean;
}

export const DEFAULT_APP_BUILDER_AI_SETTINGS: AppBuilderAiSettings = Object.freeze({
  enabled: true,
});

export const APP_BUILDER_AI_USAGE_SOURCE = 'app_builder_ai';

export const DEFAULT_APP_BUILDER_AI_OFFERS = [
  {
    name: 'AI Free',
    slug: 'ai-free',
    description: 'Starter App Builder AI quota for generated apps.',
    tokenLimit: 50_000,
    windowHours: 24,
    requestsPerMinute: 20,
    maxTokensPerRequest: 4_096,
    priority: 0,
    isActive: true,
    isDefault: true,
    displayOrder: 0,
  },
  {
    name: 'AI Pro',
    slug: 'ai-pro',
    description: 'Higher App Builder AI quota for production apps.',
    tokenLimit: 500_000,
    windowHours: 24,
    requestsPerMinute: 60,
    maxTokensPerRequest: 8_192,
    priority: 10,
    isActive: true,
    isDefault: false,
    displayOrder: 1,
  },
  {
    name: 'AI Unlimited',
    slug: 'ai-unlimited',
    description: 'Unlimited App Builder AI tokens within rate limits.',
    tokenLimit: -1,
    windowHours: 24,
    requestsPerMinute: 120,
    maxTokensPerRequest: -1,
    priority: 100,
    isActive: true,
    isDefault: false,
    displayOrder: 2,
  },
] as const;
