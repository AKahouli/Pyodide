import { qualificationSettingsEnv } from './native-qualification-host';

describe('Native qualification settings isolation', () => {
  const database = 'postgresql://postgres:test-only@127.0.0.1:55516/agentstore_test';
  const api = 'http://127.0.0.1:55517/api/v1';

  it('overrides inherited database/backend/provider settings with test-only settings by default', () => {
    const child = { DATABASE_URL: 'postgresql://shared.invalid/application', API_URL: 'https://shared.invalid/api',
      LITELLM_API_BASE_URL: 'https://provider.invalid', LITELLM_API_SECRET_KEY: 'inherited-canary',
      ...qualificationSettingsEnv(database, api) };
    expect(child.DATABASE_URL).toBe(database.replace('postgresql:', 'postgresql+asyncpg:'));
    expect(child.API_URL).toBe(api);
    expect(child.LITELLM_API_BASE_URL).toBe('http://127.0.0.1:9');
    expect(JSON.stringify(child)).not.toContain('shared.invalid');
    expect(JSON.stringify(child)).not.toContain('inherited-canary');
  });

  it('does not synthesize provider credentials for an explicitly enabled live-model qualification', () => {
    expect(qualificationSettingsEnv(database, api, true)).toEqual({
      DATABASE_URL: database.replace('postgresql:', 'postgresql+asyncpg:'), API_URL: api,
    });
  });
});
