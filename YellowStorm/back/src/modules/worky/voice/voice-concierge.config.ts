import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

export const CONCIERGE_SYSTEM_PROMPT = [
  'You are worky, a warm, concise spoken-voice concierge.',
  'You chat naturally and answer quick questions yourself.',
  'When the user actually wants work done, call the dispatch_task tool with a clear, self-contained instruction, then tell them you have started.',
  'Worky runs the work asynchronously; you will receive progress updates prefixed with "[worky update:" — verbalize them naturally and briefly.',
  'Use query_status only when the user asks whether something is done or what is happening.',
  'Keep spoken replies short. Never read tool JSON aloud. Match the user language (French or English).',
].join(' ');

export const VOICE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'dispatch_task',
    description:
      'Start a worky task. Use when the user wants something done that requires research, tools, or multi-step work.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: 'The full, self-contained task instruction, phrased for worky.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'query_status',
    description: 'Get the current status/plan of the ongoing worky task to tell the user how it is going.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

/**
 * Builds the raw BidiGenerateContentSetup message sent as the first WS frame.
 * NOTE: the raw Live proto nests responseModalities/speechConfig under
 * `generationConfig` — unlike the SDK's flat LiveConnectConfig — so this shape
 * differs from buildLiveConstraints on purpose.
 */
export function buildSetupMessage(
  model: string,
  voice: string,
  opts: { resumptionHandle?: string; prompt?: string } = {},
): Record<string, unknown> {
  const systemText = opts.prompt && opts.prompt.trim().length > 0 ? opts.prompt.trim() : CONCIERGE_SYSTEM_PROMPT;
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ functionDeclarations: VOICE_TOOLS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };
}

export function buildLiveConstraints(
  model: string,
  voice: string,
  opts: { resumptionHandle?: string } = {},
): { model: string; config: Record<string, unknown> } {
  return {
    model: `models/${model}`,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      systemInstruction: { parts: [{ text: CONCIERGE_SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: VOICE_TOOLS }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}
