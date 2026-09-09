import workyConfig from './worky.config';

describe('workyConfig', () => {
  it('exposes voice defaults', () => {
    const c = workyConfig();
    expect(c.voiceModel).toBe('gemini-3.1-flash-live-preview');
    expect(c.voiceName).toBe('Kore');
    expect(c.voiceWsBaseUrl).toContain('BidiGenerateContentConstrained');
    expect(c.voiceTokenTtlSec).toBe(1800);
    expect(c.voiceSessionStartTtlSec).toBe(60);
    expect(c.voiceApiKey).toBe('');
  });

  it('reads voice overrides from env', () => {
    process.env.WORKY_VOICE_MODEL = 'gemini-x-live';
    expect(workyConfig().voiceModel).toBe('gemini-x-live');
    delete process.env.WORKY_VOICE_MODEL;
  });

  it('exposes Electric table defaults including sessions', () => {
    const c = workyConfig();
    expect(c.electricMessagesTable).toBe('messages');
    expect(c.electricSessionsTable).toBe('sessions');
    expect(c.electricPlansTable).toBe('plans');
    expect(c.electricPlanStepsTable).toBe('plan_steps');
  });
});
