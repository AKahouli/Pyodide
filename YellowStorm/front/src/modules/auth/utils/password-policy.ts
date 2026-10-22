/**
 * Password policy — single source of truth for the password rules the backend
 * enforces (`RegisterDto`: at least one uppercase letter, one lowercase letter
 * and one digit, minimum length 8).
 *
 * The register form builds its zod schema from `PASSWORD_RULES` and reports the
 * first unmet rule inline while the user types, so the enforced rules and the
 * displayed message can never drift apart.
 */

import * as z from 'zod';
import type { ModuleTranslationKey } from '@/modules/localization';

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRuleId = 'min' | 'uppercase' | 'lowercase' | 'number';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  /** `auth`-namespace translation key describing the rule. */
  readonly messageKey: ModuleTranslationKey<'auth'>;
  readonly test: (value: string) => boolean;
}

/** Translate function scoped to the `auth` namespace. */
export type AuthPasswordTranslate = (key: ModuleTranslationKey<'auth'>) => string;

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'min', messageKey: 'register.error.passwordMin', test: (value) => value.length >= PASSWORD_MIN_LENGTH },
  { id: 'uppercase', messageKey: 'register.error.passwordUppercase', test: (value) => /[A-Z]/.test(value) },
  { id: 'lowercase', messageKey: 'register.error.passwordLowercase', test: (value) => /[a-z]/.test(value) },
  { id: 'number', messageKey: 'register.error.passwordNumber', test: (value) => /\d/.test(value) },
];

/** First rule the value does not satisfy, or `undefined` when the value is valid. */
export function firstFailedPasswordRule(value: string): PasswordRule | undefined {
  return PASSWORD_RULES.find((rule) => !rule.test(value));
}

export function isPasswordValid(value: string): boolean {
  return firstFailedPasswordRule(value) === undefined;
}

/**
 * zod schema for a password field. It reports the *first* unmet rule so the
 * inline `<FormMessage>` names a precise condition instead of a generic
 * "invalid password" error.
 */
export function createPasswordSchema(t: AuthPasswordTranslate) {
  return z.string().superRefine((value, ctx) => {
    const failed = firstFailedPasswordRule(value);
    if (failed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t(failed.messageKey) });
    }
  });
}
