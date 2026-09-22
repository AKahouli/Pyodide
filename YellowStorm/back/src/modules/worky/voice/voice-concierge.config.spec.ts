import {
  CONCIERGE_SYSTEM_PROMPT,
  buildSetupMessage,
  connectorActionsToFunctionDeclarations,
} from './voice-concierge.config';

const ACTIONS = [
  {
    key: 'dispatch_task',
    description: 'Start a worky task.',
    parameterSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'the task' }, streamId: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    key: 'get_task_details',
    description: 'Detail one task.',
    parameterSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, streamId: { type: 'string' } },
      required: ['taskId'],
    },
  },
];

describe('voice-concierge.config', () => {
  describe('connectorActionsToFunctionDeclarations', () => {
    it('maps connector actions to Gemini declarations with UPPERCASE schema types', () => {
      const decls = connectorActionsToFunctionDeclarations(ACTIONS) as any[];
      expect(decls.map((d) => d.name)).toEqual(['dispatch_task', 'get_task_details']);
      expect(decls[0].description).toBe('Start a worky task.');
      expect(decls[0].parameters.type).toBe('OBJECT');
      expect(decls[0].parameters.properties.message.type).toBe('STRING');
      expect(decls[0].parameters.required).toEqual(['message']);
      // camelCase param names, matching the front tool-call relay + DTOs
      expect(Object.keys(decls[1].parameters.properties)).toContain('taskId');
    });
  });

  describe('buildSetupMessage (raw WS proto shape)', () => {
    const decls = connectorActionsToFunctionDeclarations(ACTIONS);

    it('nests responseModalities/speechConfig under generationConfig and carries the tools', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls) as any;
      expect(s.model).toBe('models/gemini-live');
      expect(s.responseModalities).toBeUndefined(); // Gemini rejects top-level (1007)
      expect(s.generationConfig.responseModalities).toEqual(['AUDIO']);
      expect(s.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
      expect(s.systemInstruction.parts[0].text).toContain('worky');
      expect(s.tools[0].functionDeclarations).toHaveLength(2);
      expect(s.inputAudioTranscription).toBeDefined();
      expect(s.outputAudioTranscription).toBeDefined();
      expect(s.contextWindowCompression.slidingWindow).toBeDefined();
    });

    it('threads the resumption handle', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls, { resumptionHandle: 'h-1' }) as any;
      expect(s.sessionResumption.handle).toBe('h-1');
    });

    it('uses a provided prompt override', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls, { prompt: 'Custom persona X' }) as any;
      expect(s.systemInstruction.parts[0].text).toBe('Custom persona X');
    });

    it('falls back to the default prompt when override is blank', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls, { prompt: '   ' }) as any;
      expect(s.systemInstruction.parts[0].text).toContain('worky');
    });

    it('CONCIERGE_SYSTEM_PROMPT mentions worky', () => {
      expect(CONCIERGE_SYSTEM_PROMPT).toContain('worky');
    });

    it('requires verifying a person via search_human_agents before dispatching', () => {
      expect(CONCIERGE_SYSTEM_PROMPT).toContain('search_human_agents');
      expect(CONCIERGE_SYSTEM_PROMPT).toMatch(/before you dispatch/i);
    });

    it('appends the requester name and role to the system instruction', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls, {
        requester: { name: 'Rabeb Sdiri', email: 'rabeb@yellowsys.fr', role: 'Data Scientist' },
      }) as any;
      const text = s.systemInstruction.parts[0].text;
      expect(text).toContain('worky'); // base persona kept
      expect(text).toContain('Rabeb Sdiri');
      expect(text).toContain('Data Scientist');
    });

    it('adds no identity line when there is no requester name', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', decls, {
        requester: { name: '', email: '', role: 'x' },
      }) as any;
      expect(s.systemInstruction.parts[0].text).toBe(CONCIERGE_SYSTEM_PROMPT);
    });
  });
});
