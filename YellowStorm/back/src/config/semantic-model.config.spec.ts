import semanticModelConfig from './semantic-model.config';
import { configValidationSchema } from './config.schema';

describe('semanticModelConfig', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('disables all runtime flags by default', () => {
    delete process.env.SEMANTIC_MODEL_RUNTIME_ENABLED;
    delete process.env.SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED;
    delete process.env.SEMANTIC_MODEL_CONTEXT_SEARCH_ENABLED;
    delete process.env.SEMANTIC_MODEL_LLM_FALLBACK_ENABLED;
    const cfg = semanticModelConfig();
    expect(cfg.runtimeEnabled).toBe(false);
    expect(cfg.runtimeWritesEnabled).toBe(false);
    expect(cfg.contextSearchEnabled).toBe(false);
    expect(cfg.llmFallbackEnabled).toBe(false);
  });

  it('reads each runtime flag from its environment variable', () => {
    process.env.SEMANTIC_MODEL_RUNTIME_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_CONTEXT_SEARCH_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_LLM_FALLBACK_ENABLED = 'true';
    const cfg = semanticModelConfig();
    expect(cfg.runtimeEnabled).toBe(true);
    expect(cfg.runtimeWritesEnabled).toBe(true);
    expect(cfg.contextSearchEnabled).toBe(true);
    expect(cfg.llmFallbackEnabled).toBe(true);
  });

  it('rejects a config schema where writes are enabled without the runtime', () => {
    const valid = configValidationSchema.validate({
      SEMANTIC_MODEL_RUNTIME_ENABLED: 'true',
      SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED: 'true',
    });
    expect(valid.error).toBeUndefined();

    const invalid = configValidationSchema.validate({
      SEMANTIC_MODEL_RUNTIME_ENABLED: 'false',
      SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED: 'true',
    });
    expect(invalid.error).toBeDefined();
    expect(invalid.error?.message).toContain('SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED');
  });
});
