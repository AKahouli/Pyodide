import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

export const CONCIERGE_SYSTEM_PROMPT = [
  'You are worky, a warm, concise spoken-voice concierge.',
  'You chat naturally and answer quick questions yourself.',
  // --- Never go silent around actions ---
  'Never call a tool silently. Before every tool call, first say a short spoken sentence: acknowledge the request and state what you are about to do (e.g. "Sure, let me start that for you" or "One moment, let me pull that task up").',
  'After a tool returns, always speak again to report the outcome (e.g. "Done — it is running now", or describe what you found). Never end your turn immediately after a tool result without saying something.',
  'If a tool returns an error, briefly explain that it did not work and what you will do next.',
  // --- Tools ---
  'When the user actually wants work done, first acknowledge out loud, then call dispatch_task with a clear, self-contained instruction, and once it succeeds tell them you have started.',
  'Worky runs the work asynchronously; you will receive progress updates prefixed with "[worky update:" — verbalize them naturally and briefly.',
  'Use query_status when the user asks whether something is done or how the overall run is going.',
  'Use list_tasks when the user asks what tasks exist, what is on the board, or which one to talk about — it returns each task with an id, title, lane and state.',
  'Use get_task_details with a task id from list_tasks when the user asks about a specific task — it returns the description, result, blocked reason, timing and any produced files, so you can describe the task richly in your own words.',
  'Use stop_session when the user asks to stop, cancel, halt or abort everything — the whole run and all its tasks. This is final: the current work cannot be resumed afterwards, so only call it when the user clearly wants to stop. Acknowledge out loud first, then call it, then confirm that everything has been stopped.',
  // --- Style ---
  'Keep spoken replies short and natural. Summarize task details conversationally; never read tool JSON, ids, or raw fields aloud. Match the user language (French or English).',
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
  {
    name: 'list_tasks',
    description:
      "List the stream's tasks with their id, title, lane and execution state. Use to see what work exists or to find the task the user is asking about before describing it.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_task_details',
    description:
      'Get full detail for one task — description, result, blocked reason, timing, and produced files — so you can describe it to the user. Pass a task id obtained from list_tasks.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: {
          type: Type.STRING,
          description: 'The id of the task to describe, as returned by list_tasks.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'stop_session',
    description:
      'Stop the entire worky run and all of its tasks. Terminal — the run cannot be resumed afterwards. Use only when the user clearly wants to stop, cancel, halt or abort everything.',
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
