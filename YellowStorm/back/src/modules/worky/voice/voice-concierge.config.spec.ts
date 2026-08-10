import { CONCIERGE_SYSTEM_PROMPT, VOICE_TOOLS, buildLiveConstraints } from './voice-concierge.config';

describe('voice-concierge.config', () => {
  it('declares exactly the two v1 tools', () => {
    const names = VOICE_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['dispatch_task', 'query_status']);
    const dispatch = VOICE_TOOLS.find((t) => t.name === 'dispatch_task')!;
    expect(Object.keys(dispatch.parameters!.properties!)).toContain('message');
    expect(dispatch.parameters!.required).toContain('message');
  });

  it('binds model, voice, transcription, resumption, compression and tools', () => {
    const c = buildLiveConstraints('gemini-live', 'Kore');
    expect(c.model).toBe('models/gemini-live');
    expect((c.config as any).responseModalities).toEqual(['AUDIO']);
    expect((c.config as any).speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect((c.config as any).inputAudioTranscription).toBeDefined();
    expect((c.config as any).outputAudioTranscription).toBeDefined();
    expect((c.config as any).sessionResumption).toBeDefined();
    expect((c.config as any).contextWindowCompression).toBeDefined();
    expect((c.config as any).tools[0].functionDeclarations).toHaveLength(2);
    expect((c.config as any).systemInstruction.parts[0].text).toContain('worky');
    expect(CONCIERGE_SYSTEM_PROMPT).toContain('worky');
  });

  it('passes a resumption handle through when reconnecting', () => {
    const c = buildLiveConstraints('gemini-live', 'Kore', { resumptionHandle: 'h-123' });
    expect((c.config as any).sessionResumption.handle).toBe('h-123');
  });
});
