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
    delete process.env.SEMANTIC_MODEL_DATA_API_ENABLED;
    delete process.env.SEMANTIC_MODEL_REALTIME_ENABLED;
    delete process.env.SEMANTIC_DATA_REALTIME_URL;
    const cfg = semanticModelConfig();
    expect(cfg.runtimeEnabled).toBe(false);
    expect(cfg.runtimeWritesEnabled).toBe(false);
    expect(cfg.contextSearchEnabled).toBe(false);
    expect(cfg.llmFallbackEnabled).toBe(false);
    expect(cfg.dataApiEnabled).toBe(false);
    expect(cfg.realtimeEnabled).toBe(false);
    expect(cfg.dataRealtimeUrl).toBe('ws://yellowmind-semantic.localhost:4000');
  });

  it('reads each runtime flag from its environment variable', () => {
    process.env.SEMANTIC_MODEL_RUNTIME_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_CONTEXT_SEARCH_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_LLM_FALLBACK_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_DATA_API_ENABLED = 'true';
    process.env.SEMANTIC_MODEL_REALTIME_ENABLED = 'true';
    const cfg = semanticModelConfig();
    expect(cfg.runtimeEnabled).toBe(true);
    expect(cfg.runtimeWritesEnabled).toBe(true);
    expect(cfg.contextSearchEnabled).toBe(true);
    expect(cfg.llmFallbackEnabled).toBe(true);
    expect(cfg.dataApiEnabled).toBe(true);
    expect(cfg.realtimeEnabled).toBe(true);
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

  it('rejects realtime without the data API', () => {
    const invalid = configValidationSchema.validate({
      SEMANTIC_MODEL_DATA_API_ENABLED: 'false',
      SEMANTIC_MODEL_REALTIME_ENABLED: 'true',
    });
    expect(invalid.error?.message).toContain('SEMANTIC_MODEL_REALTIME_ENABLED');
  });

  it('requires JWT MCP auth mode in production and rejects Bearer there (WP06.1)', () => {
    // Satisfies the schema's other production-only requirements so the ONLY
    // variable under test is the MCP auth mode.
    const production = {
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(64),
      JWT_SECRET: 'j'.repeat(32),
      SEMANTIC_MODEL_MCP_SERVICE_TOKEN: 'semantic-mcp-principal-secret-1',
      APP_RUNTIME_BIND_TOKEN: 'app-runtime-bind-secret-01',
    };
    const productionJwt = configValidationSchema.validate({
      ...production,
      SEMANTIC_MODEL_MCP_AUTH_MODE: 'JWT',
    }, { allowUnknown: true });
    expect(productionJwt.error).toBeUndefined();

    // A conditional .valid must REPLACE the allowlist in production, not
    // union with it: Bearer stays acceptable only outside production.
    const productionBearer = configValidationSchema.validate({
      ...production,
      SEMANTIC_MODEL_MCP_AUTH_MODE: 'Bearer',
    }, { allowUnknown: true });
    expect(productionBearer.error).toBeDefined();
    expect(productionBearer.error?.message).toContain('SEMANTIC_MODEL_MCP_AUTH_MODE');

    const devBearer = configValidationSchema.validate({
      NODE_ENV: 'development',
      SEMANTIC_MODEL_MCP_AUTH_MODE: 'Bearer',
    }, { allowUnknown: true });
    expect(devBearer.error).toBeUndefined();
  });
});
