/**
 * Column shapes of catalog.guardrails_settings
 * (types only since the 1B.2 PostgreSQL cutover).
 */
export interface PromptInjectionGuardrailsSettings {
  inputEnabled: boolean;
  outputEnabled: boolean;
  mode: 'monitor' | 'balanced' | 'strict';
  inputClassifierPrompt: string;
  outputClassifierPrompt: string;
  blockMessage: string;
}

export interface ToolActionReviewSettings {
  enabled: boolean;
  mode: 'monitor' | 'balanced' | 'strict';
  classifierPrompt: string;
  blockMessage: string;
}
