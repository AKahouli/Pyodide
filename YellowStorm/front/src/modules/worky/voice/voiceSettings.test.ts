import { describe, it, expect } from 'vitest';
import { useVoiceSettings } from './voiceSettings';

describe('voiceSettings.realtimeVoice', () => {
  it('defaults realtimeVoice to true', () => {
    expect(useVoiceSettings.getState().realtimeVoice).toBe(true);
  });
  it('can toggle realtimeVoice', () => {
    useVoiceSettings.getState().set('realtimeVoice', false);
    expect(useVoiceSettings.getState().realtimeVoice).toBe(false);
    useVoiceSettings.getState().set('realtimeVoice', true);
    expect(useVoiceSettings.getState().realtimeVoice).toBe(true);
  });
});
