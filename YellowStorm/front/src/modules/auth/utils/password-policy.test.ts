import { describe, expect, it } from 'vitest';
import { PASSWORD_RULES, createPasswordSchema, firstFailedPasswordRule, isPasswordValid } from './password-policy';

describe('password-policy', () => {
  it('accepts a password that meets every rule', () => {
    expect(isPasswordValid('Passw0rd')).toBe(true);
    expect(firstFailedPasswordRule('Passw0rd')).toBeUndefined();
  });

  it('reports the first unmet rule in declared order', () => {
    expect(firstFailedPasswordRule('Pa0')?.id).toBe('min');
    expect(firstFailedPasswordRule('passw0rd')?.id).toBe('uppercase');
    expect(firstFailedPasswordRule('PASSW0RD')?.id).toBe('lowercase');
    expect(firstFailedPasswordRule('Password')?.id).toBe('number');
  });

  it('exposes the rule list as the single source of truth', () => {
    expect(PASSWORD_RULES.map((rule) => rule.id)).toEqual(['min', 'uppercase', 'lowercase', 'number']);
  });

  it('builds a schema that reports the first unmet rule message', () => {
    const schema = createPasswordSchema((key) => key);
    const result = schema.safeParse('passw0rd');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].message).toBe('register.error.passwordUppercase');
    }
  });

  it('accepts a valid password through the schema', () => {
    const schema = createPasswordSchema((key) => key);
    expect(schema.safeParse('Passw0rd').success).toBe(true);
  });
});
