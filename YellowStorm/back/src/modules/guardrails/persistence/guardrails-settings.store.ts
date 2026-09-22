import type { AdminGuardrailsSettings } from '../services/guardrails-settings.service';

/**
 * Store port for catalog.guardrails_settings (plan 1B.2.3) — the singleton
 * row. Values are the raw persisted columns; the service applies defaults.
 */
export const GUARDRAILS_SETTINGS_STORE = Symbol('GUARDRAILS_SETTINGS_STORE');

export type GuardrailsSettingsRow = Partial<Pick<AdminGuardrailsSettings, 'forceActivation' | 'promptInjection' | 'toolActionReview'>>;

export interface GuardrailsSettingsStore {
  find(): Promise<GuardrailsSettingsRow | null>;
  upsert(next: AdminGuardrailsSettings): Promise<void>;
}
