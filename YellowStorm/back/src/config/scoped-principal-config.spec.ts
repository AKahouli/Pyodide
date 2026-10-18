import { configValidationSchema } from './config.schema';
import * as Joi from 'joi';

describe('R01 independent principal startup configuration', () => {
  const keys = ['AGENT_MCP_BACKEND_SERVICE_TOKEN', 'PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN',
    'SEMANTIC_MODEL_MCP_SERVICE_TOKEN', 'ADK_RUNTIME_MCP_RENEWAL_TOKEN', 'APP_RUNTIME_BIND_TOKEN',
    'SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN', 'ADK_ROOT_RUNTIME_SERVICE_TOKEN',
    'ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN'];
  const validate = (values: Record<string, unknown>) => configValidationSchema.validate(values, { allowUnknown: true, abortEarly: false });

  it('accepts independently provisioned production principals in the actual scoped field schemas', () => {
    const scoped = Joi.object({ NODE_ENV: Joi.string(),
      ...Object.fromEntries(keys.map(key => [key, configValidationSchema.extract(key)])),
    });
    const values = Object.fromEntries(keys.map((name, i) => [name, `synthetic-${i}-${'x'.repeat(32)}`]));
    expect(scoped.validate({ NODE_ENV: 'production', ...values }).error).toBeUndefined();
  });

  it.each(keys)('rejects absent, blank or short production %s', key => {
    const valid = Object.fromEntries(keys.map((name, i) => [name, `synthetic-${i}-${'x'.repeat(32)}`]));
    for (const invalid of [undefined, '', 'short', ` ${'x'.repeat(32)}`]) {
      const result = validate({ NODE_ENV: 'production', ...valid, [key]: invalid });
      expect(result.error).toBeDefined();
      expect(result.error!.details.some(detail => detail.path.includes(key))).toBe(true);
    }
  });

  it('rejects equal configured keys, including legacy compatibility authority, without values in the message', () => {
    for (const first of keys) {
      for (const second of [...keys, 'INTERNAL_SERVICE_SECRET'].filter(key => key !== first)) {
        const result = validate({ NODE_ENV: 'test', [first]: 'SYNTHETIC_PRIVATE_CANARY', [second]: 'SYNTHETIC_PRIVATE_CANARY' });
        expect(result.error).toBeDefined();
        expect(result.error!.message).not.toContain('SYNTHETIC_PRIVATE_CANARY');
      }
    }
  });

  it('allows unconfigured development principals, but no whitespace-only or padded configured secret', () => {
    expect(validate({ NODE_ENV: 'test' }).error).toBeUndefined();
    expect(validate({ NODE_ENV: 'test', AGENT_MCP_BACKEND_SERVICE_TOKEN: '    ' }).error).toBeDefined();
    expect(validate({ NODE_ENV: 'test', AGENT_MCP_BACKEND_SERVICE_TOKEN: 'padded ' }).error).toBeDefined();
  });
});
